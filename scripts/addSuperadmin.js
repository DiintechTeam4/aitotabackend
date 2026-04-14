require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Superadmin = require('../models/Superadmin');
const connectDB = require('../config/db');

const addSuperadmin = async () => {
    try {
        // Connect to Database
        await connectDB();

        // Get details from command line or use defaults
        const name = process.argv[2] || "Super Admin";
        const email = process.argv[3] || "admin@aitota.com";
        const password = process.argv[4] || "Admin@aitota123";

        if (!email || !password) {
            console.error('Usage: node scripts/addSuperadmin.js <name> <email> <password>');
            process.exit(1);
        }

        // Check if superadmin already exists
        const existingAdmin = await Superadmin.findOne({ email });
        if (existingAdmin) {
            console.log(`  ⚠ Superadmin with email ${email} already exists.`);
            process.exit(0);
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Create new superadmin
        const newAdmin = new Superadmin({
            name,
            email,
            password: hashedPassword
        });

        await newAdmin.save();

        console.log('\n  ✅ Superadmin created successfully!');
        console.log('  ----------------------------------');
        console.log(`  Name    : ${name}`);
        console.log(`  Email   : ${email}`);
        console.log(`  Password: ${password}`);
        console.log('  ----------------------------------\n');
        
        await mongoose.connection.close();
        console.log('  ✓ Database connection closed');
        process.exit(0);
    } catch (error) {
        console.error('\n  ❌ Error adding superadmin:', error.message);
        process.exit(1);
    }
};

addSuperadmin();
