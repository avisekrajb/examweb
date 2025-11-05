require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const session = require('express-session');
const methodOverride = require('method-override');
const { GridFSBucket } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(methodOverride('_method'));

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI;

console.log('🔗 Connecting to MongoDB Atlas...');

mongoose.connect(MONGODB_URI)
.then(() => {
    console.log('✅ MongoDB Atlas Connected Successfully!');
})
.catch(err => {
    console.log('❌ MongoDB Connection Failed:', err.message);
});

// PDF Schema
const pdfSchema = new mongoose.Schema({
    name: { type: String, required: true },
    filename: { type: String, required: true },
    subject: { type: String, required: true },
    fileId: { type: mongoose.Types.ObjectId, required: true },
    uploadDate: { type: Date, default: Date.now }
});

const PDF = mongoose.model('PDF', pdfSchema);

// GridFS Setup
let gfs;
const conn = mongoose.connection;
conn.once('open', () => {
    gfs = new GridFSBucket(conn.db, { bucketName: 'pdfs' });
    console.log('✅ GridFS Initialized');
});

// Multer configuration
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed'), false);
        }
    }
});

// Admin Credentials
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'a@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '12345';

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/pdfs', async (req, res) => {
    try {
        const pdfs = await PDF.find().sort({ uploadDate: -1 });
        res.json(pdfs);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch PDFs' });
    }
});

app.get('/api/pdf/:id/download', async (req, res) => {
    try {
        const pdf = await PDF.findById(req.params.id);
        if (!pdf) return res.status(404).json({ error: 'PDF not found' });

        res.set('Content-Type', 'application/pdf');
        res.set('Content-Disposition', `attachment; filename="${pdf.filename}"`);

        const downloadStream = gfs.openDownloadStream(pdf.fileId);
        downloadStream.pipe(res);
    } catch (error) {
        res.status(500).json({ error: 'Failed to download PDF' });
    }
});

app.get('/api/pdf/:id/view', async (req, res) => {
    try {
        const pdf = await PDF.findById(req.params.id);
        if (!pdf) return res.status(404).json({ error: 'PDF not found' });

        res.set('Content-Type', 'application/pdf');
        res.set('Content-Disposition', `inline; filename="${pdf.filename}"`);

        const downloadStream = gfs.openDownloadStream(pdf.fileId);
        downloadStream.pipe(res);
    } catch (error) {
        res.status(500).json({ error: 'Failed to view PDF' });
    }
});

app.post('/api/admin/login', (req, res) => {
    const { email, password } = req.body;
    if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
        req.session.admin = true;
        res.json({ success: true });
    } else {
        res.json({ success: false, error: 'Invalid credentials' });
    }
});

app.get('/api/admin/check', (req, res) => {
    res.json({ isAdmin: !!req.session.admin });
});

app.post('/api/admin/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.post('/api/admin/upload', upload.single('pdf'), async (req, res) => {
    if (!req.session.admin) {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    try {
        const { name, subject } = req.body;
        if (!req.file) return res.status(400).json({ error: 'No PDF file uploaded' });

        const uploadStream = gfs.openUploadStream(req.file.originalname);
        const newPDF = new PDF({
            name,
            filename: req.file.originalname,
            subject,
            fileId: uploadStream.id
        });

        uploadStream.end(req.file.buffer);

        uploadStream.on('finish', async () => {
            await newPDF.save();
            res.json({ success: true, message: 'PDF uploaded successfully!', pdf: newPDF });
        });

        uploadStream.on('error', () => {
            res.status(500).json({ error: 'Failed to upload PDF' });
        });

    } catch (error) {
        res.status(500).json({ error: 'Failed to upload PDF' });
    }
});

app.delete('/api/admin/pdf/:id', async (req, res) => {
    if (!req.session.admin) {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    try {
        const pdf = await PDF.findById(req.params.id);
        if (!pdf) return res.status(404).json({ error: 'PDF not found' });

        await gfs.delete(pdf.fileId);
        await PDF.findByIdAndDelete(req.params.id);

        res.json({ success: true, message: 'PDF deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete PDF' });
    }
});

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'PDF Management System is running',
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV}`);
});
