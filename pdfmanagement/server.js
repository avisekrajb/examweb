require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const session = require('express-session');
const methodOverride = require('method-override');
const { GridFSBucket } = require('mongodb');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Create uploads directory if it doesn't exist
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(methodOverride('_method'));

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'pdf-management-simple-secret-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

// MongoDB Atlas Connection
const MONGODB_URI = process.env.MONGODB_URI;

console.log('🔗 Connecting to MongoDB Atlas...');

mongoose.connect(MONGODB_URI)
.then(() => {
    console.log('✅ MongoDB Atlas Connected Successfully!');
    console.log('🏠 Host:', mongoose.connection.host);
    console.log('📊 Database:', mongoose.connection.name);
})
.catch(err => {
    console.log('❌ MongoDB Connection Failed:');
    console.log('   Error:', err.message);
    process.exit(1);
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
    gfs = new GridFSBucket(conn.db, {
        bucketName: 'pdfs'
    });
    console.log('✅ GridFS Initialized');
});

// Multer configuration
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024
    },
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

// Check MongoDB connection
function isDBConnected() {
    return mongoose.connection.readyState === 1;
}

// Create sample PDF files in GridFS
async function createSamplePDFs() {
    try {
        const samplePDFs = [
            {
                name: "Computer Communication Notes",
                filename: "cc.pdf",
                subject: "api",
                content: "This is sample Computer Communication PDF content"
            },
            {
                name: "Basic Electronics Handbook", 
                filename: "be.pdf",
                subject: "bct",
                content: "This is sample Basic Electronics PDF content"
            },
            {
                name: "Universal Human Values Guide",
                filename: "uhv.pdf", 
                subject: "uhv",
                content: "This is sample UHV PDF content"
            },
            {
                name: "Social Network Security",
                filename: "snsw.pdf",
                subject: "snsw", 
                content: "This is sample SNSW PDF content"
            }
        ];

        for (const sample of samplePDFs) {
            // Check if PDF already exists
            const existingPDF = await PDF.findOne({ filename: sample.filename });
            if (!existingPDF) {
                // Create upload stream to GridFS
                const uploadStream = gfs.openUploadStream(sample.filename, {
                    metadata: {
                        originalName: sample.filename,
                        subject: sample.subject,
                        uploadDate: new Date(),
                        isSample: true
                    }
                });

                // Create PDF document
                const newPDF = new PDF({
                    name: sample.name,
                    filename: sample.filename,
                    subject: sample.subject,
                    fileId: uploadStream.id
                });

                // Upload sample content
                uploadStream.end(Buffer.from(sample.content));

                uploadStream.on('finish', async () => {
                    await newPDF.save();
                    console.log(`✅ Sample PDF created: ${sample.filename}`);
                });

                uploadStream.on('error', (error) => {
                    console.error(`Error creating sample PDF ${sample.filename}:`, error);
                });
            }
        }
    } catch (error) {
        console.error('Error creating sample PDFs:', error);
    }
}

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Get all PDFs
app.get('/api/pdfs', async (req, res) => {
    try {
        if (!isDBConnected()) {
            return res.status(503).json({ error: 'Database not connected' });
        }

        const pdfs = await PDF.find().sort({ uploadDate: -1 });
        console.log(`📄 Serving ${pdfs.length} PDFs from MongoDB`);
        res.json(pdfs);
    } catch (error) {
        console.error('Error fetching PDFs:', error);
        res.status(500).json({ error: 'Failed to fetch PDFs' });
    }
});

// Download PDF
app.get('/api/pdf/:id/download', async (req, res) => {
    try {
        if (!isDBConnected()) {
            return res.status(503).json({ error: 'Database not connected' });
        }

        const pdf = await PDF.findById(req.params.id);
        if (!pdf) {
            return res.status(404).json({ error: 'PDF not found' });
        }

        // For sample PDFs, create a demo download
        const file = await gfs.find({ filename: pdf.filename }).toArray();
        if (file.length === 0) {
            // Create a demo PDF content
            const demoContent = `This is a demo PDF for: ${pdf.name}\nSubject: ${pdf.subject}\nFilename: ${pdf.filename}\n\nThis PDF is stored in MongoDB Atlas Cloud.`;
            
            res.set('Content-Type', 'application/pdf');
            res.set('Content-Disposition', `attachment; filename="${pdf.filename}"`);
            res.send(Buffer.from(demoContent));
            return;
        }

        res.set('Content-Type', 'application/pdf');
        res.set('Content-Disposition', `attachment; filename="${pdf.filename}"`);

        const downloadStream = gfs.openDownloadStream(pdf.fileId);

        downloadStream.on('data', (chunk) => {
            res.write(chunk);
        });

        downloadStream.on('end', () => {
            res.end();
        });

        downloadStream.on('error', (error) => {
            console.error('Download error:', error);
            res.status(500).json({ error: 'Error downloading file' });
        });

    } catch (error) {
        console.error('Download PDF error:', error);
        res.status(500).json({ error: 'Failed to download PDF' });
    }
});

// View PDF
app.get('/api/pdf/:id/view', async (req, res) => {
    try {
        if (!isDBConnected()) {
            return res.status(503).json({ error: 'Database not connected' });
        }

        const pdf = await PDF.findById(req.params.id);
        if (!pdf) {
            return res.status(404).json({ error: 'PDF not found' });
        }

        res.set('Content-Type', 'application/pdf');
        res.set('Content-Disposition', `inline; filename="${pdf.filename}"`);

        const downloadStream = gfs.openDownloadStream(pdf.fileId);

        downloadStream.on('data', (chunk) => {
            res.write(chunk);
        });

        downloadStream.on('end', () => {
            res.end();
        });

        downloadStream.on('error', (error) => {
            console.error('View PDF error:', error);
            res.status(500).json({ error: 'Error viewing file' });
        });

    } catch (error) {
        console.error('View PDF error:', error);
        res.status(500).json({ error: 'Failed to view PDF' });
    }
});

// Admin login
app.post('/api/admin/login', (req, res) => {
    const { email, password } = req.body;

    if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
        req.session.admin = true;
        res.json({ success: true });
    } else {
        res.json({ success: false, error: 'Invalid credentials' });
    }
});

// Check admin status
app.get('/api/admin/check', (req, res) => {
    res.json({ isAdmin: !!req.session.admin });
});

// Admin logout
app.post('/api/admin/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Upload PDF
app.post('/api/admin/upload', upload.single('pdf'), async (req, res) => {
    if (!req.session.admin) {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    if (!isDBConnected()) {
        return res.status(503).json({ error: 'Database not connected' });
    }

    try {
        const { name, subject } = req.body;

        if (!req.file) {
            return res.status(400).json({ error: 'No PDF file uploaded' });
        }

        // Create upload stream to GridFS
        const uploadStream = gfs.openUploadStream(req.file.originalname, {
            metadata: {
                originalName: req.file.originalname,
                subject: subject,
                uploadDate: new Date()
            }
        });

        // Create PDF document
        const newPDF = new PDF({
            name: name,
            filename: req.file.originalname,
            subject: subject,
            fileId: uploadStream.id
        });

        // Upload file to GridFS
        uploadStream.end(req.file.buffer);

        uploadStream.on('finish', async () => {
            await newPDF.save();
            console.log(`✅ PDF uploaded to MongoDB: ${req.file.originalname}`);

            res.json({
                success: true,
                message: 'PDF uploaded successfully to MongoDB Atlas!',
                pdf: newPDF
            });
        });

        uploadStream.on('error', (error) => {
            console.error('GridFS upload error:', error);
            res.status(500).json({ error: 'Failed to upload PDF to MongoDB' });
        });

    } catch (error) {
        console.error('Upload PDF error:', error);
        res.status(500).json({ error: 'Failed to upload PDF' });
    }
});

// Delete PDF
app.delete('/api/admin/pdf/:id', async (req, res) => {
    if (!req.session.admin) {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    if (!isDBConnected()) {
        return res.status(503).json({ error: 'Database not connected' });
    }

    try {
        const pdf = await PDF.findById(req.params.id);
        if (!pdf) {
            return res.status(404).json({ error: 'PDF not found' });
        }

        // Delete from GridFS
        await gfs.delete(pdf.fileId);

        // Delete from database
        await PDF.findByIdAndDelete(req.params.id);

        console.log(`🗑️ PDF deleted: ${pdf.filename}`);

        res.json({ 
            success: true, 
            message: 'PDF deleted successfully!' 
        });
    } catch (error) {
        console.error('Delete PDF error:', error);
        res.status(500).json({ error: 'Failed to delete PDF' });
    }
});

// Health check
app.get('/api/health', async (req, res) => {
    try {
        const pdfCount = isDBConnected() ? await PDF.countDocuments() : 0;
        
        res.json({
            status: 'OK',
            database: isDBConnected() ? 'Connected to MongoDB Atlas' : 'Disconnected',
            pdfCount: pdfCount,
            storage: 'MongoDB GridFS',
            collections: ['pdfs', 'pdfs.files', 'pdfs.chunks'],
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.json({
            status: 'Error',
            database: 'Connection issue',
            error: error.message
        });
    }
});

// Initialize database with sample data
async function initializeDatabase() {
    try {
        if (isDBConnected()) {
            const count = await PDF.countDocuments();
            console.log(`📊 Current PDF count: ${count}`);
            
            if (count === 0) {
                console.log('💡 Creating sample PDFs...');
                setTimeout(createSamplePDFs, 2000);
            } else {
                console.log('✅ Database already has PDF data');
            }
        }
    } catch (error) {
        console.log('❌ Error initializing database:', error.message);
    }
}

// Start server
app.listen(PORT, () => {
    console.log('🚀 Server running on port', PORT);
    console.log('📄 PDF Management System Ready');
    console.log('💾 Storage: MongoDB Atlas Cloud');
    console.log('👨‍💼 Admin: a@gmail.com / 12345');
    console.log('🌐 Visit: http://localhost:' + PORT);
    
    // Initialize database
    setTimeout(initializeDatabase, 3000);
});