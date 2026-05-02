const mongoose = require('mongoose');

const MONGO_OPTIONS = {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    connectTimeoutMS: 10000,
    heartbeatFrequencyMS: 10000,
    retryWrites: true,
    maxPoolSize: 10,
    family: 4, // Force IPv4 to avoid DNS issues
};

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI, MONGO_OPTIONS);
        console.log('  ✓ Database connected');
    } catch (error) {
        console.error('  ✗ Database connection failed:', error.message);
        process.exit(1);
    }
};

// Auto-reconnect on disconnect
mongoose.connection.on('disconnected', () => {
    console.warn('  ⚠ MongoDB disconnected. Attempting reconnect...');
    setTimeout(() => {
        mongoose.connect(process.env.MONGODB_URI, MONGO_OPTIONS).catch(err => {
            console.error('  ✗ Reconnect failed:', err.message);
        });
    }, 5000);
});

mongoose.connection.on('error', (err) => {
    console.error('  ✗ MongoDB error:', err.message);
});

mongoose.connection.on('reconnected', () => {
    console.log('  ✓ MongoDB reconnected');
});

module.exports = connectDB;