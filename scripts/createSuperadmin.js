require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const Superadmin = require('../models/Superadmin');

async function createSuperadmin() {
    await mongoose.connect(process.env.MONGODB_URI);

    const email = process.env.SUPERADMIN_EMAIL;
    const password = process.env.SUPERADMIN_PASSWORD;

    const existing = await Superadmin.findOne({ email });
    if (existing) {
        console.log('Superadmin already exists:', email);
        process.exit(0);
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await Superadmin.create({ name: 'Super Admin', email, password: hashedPassword });

    console.log('Superadmin created successfully!');
    console.log('Email:', email);
    console.log('Password:', password);
    process.exit(0);
}

createSuperadmin().catch(err => { console.error(err); process.exit(1); });
