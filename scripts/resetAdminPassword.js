require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Admin = require('../models/Admin');
const connectDB = require('../config/db');

const resetPassword = async () => {
    try {
        await connectDB();

        const email = process.argv[2];
        const newPassword = process.argv[3] || '123456';

        if (!email) {
            console.error('Usage: node scripts/resetAdminPassword.js <email> <newPassword>');
            process.exit(1);
        }

        const admin = await Admin.findOne({ email });
        if (!admin) {
            console.error(`  ❌ Admin not found with email: ${email}`);
            // List all admins
            const all = await Admin.find({}, 'name email').lean();
            console.log('  Available admins:');
            all.forEach(a => console.log(`    - ${a.email} (${a.name})`));
            process.exit(1);
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        await Admin.findByIdAndUpdate(admin._id, { password: hashedPassword });

        console.log('\n  ✅ Password reset successfully!');
        console.log(`  Email   : ${email}`);
        console.log(`  Password: ${newPassword}`);

        await mongoose.connection.close();
        process.exit(0);
    } catch (error) {
        console.error('  ❌ Error:', error.message);
        process.exit(1);
    }
};

resetPassword();
