const bcrypt=require("bcrypt");
const jwt = require('jsonwebtoken')
const Superadmin = require("../models/Superadmin");
const Admin = require("../models/Admin");
const Client = require("../models/Client");

const generateToken = (id) => {
    return jwt.sign({id},process.env.JWT_SECRET,{
        expiresIn:"1d",
    })
};

exports.registerSuperadmin = async (req,res) => {
    try {
    const { name, email, password, superadmincode } = req.body;
    console.log(superadmincode)
    if (superadmincode !== process.env.SUPERADMIN_REGISTRATION_CODE) {
      res.status(401).json({ message: "Invalid superadmin code" });
    }

    const existingSuperadmin = await Superadmin.findOne({email});
    if(existingSuperadmin)
    {
      res.status(400).json({ message: "Superadmin already exists" });
    }
    else 
    {
      const hashedPassword = await bcrypt.hash(password,10);
      const superadmin = await Superadmin.create({
        name,
        email,
        password:hashedPassword
      })
      const token = await generateToken(superadmin._id);

      res.status(200).json({
        success:true,
        message:"superadmin registered successfully",
        token:token,
        superadmin
      })
    }
}
    catch (error) {
        res.status(400).json({ message: error });
        console.log(error);
    }
}

exports.loginSuperadmin = async (req,res) => {
    try {
    const {email,password}=req.body;

    if(!email || !password)
    {
        return res.status(400).json({
        message: "Email and password are required",
        received: { email: !!email, password: !!password }        
    });
    }

    const superadmin = await Superadmin.findOne({email});

    console.log('Found superadmin:', superadmin ? 'Yes' : 'No');

    if(!superadmin) {
        return res.status(400).json({message:"Superadmin not found"});
    }

    const isPasswordValid = await bcrypt.compare(password,superadmin.password);

    if(!isPasswordValid)
    {
        res.status(400).json({message:"Invalid Credentials"})
    }
    const token = generateToken(superadmin._id);

    res.status(200).json({
        success:true,
        message:"login successfully",
        token:token,
        superadmin
    })
 
    } 
    catch (error) {
    res.status(500).json({message: "Internal server error"});
    console.log(error)
    }
}

exports.getAdmins = async (req, res) => {
    try {
        const admins = await Admin.find().select('-password');
        res.status(200).json({ success: true, data: admins, count: admins.length });
    } catch (error) {
        res.status(500).json({ message: "Internal server error" });
    }
};

exports.getClients = async (req, res) => {
    try {
        const clients = await Client.find().select('-password');
        res.status(200).json({ success: true, data: clients, count: clients.length });
    } catch (error) {
        res.status(500).json({ message: "Internal server error" });
    }
};

exports.deleteAdmin = async (req, res) => {
    try {
        const admin = await Admin.findByIdAndDelete(req.params.id);
        if (!admin) return res.status(404).json({ message: "Admin not found" });
        res.status(200).json({ success: true, message: "Admin deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: "Internal server error" });
    }
};

exports.deleteClient = async (req, res) => {
    try {
        const client = await Client.findByIdAndDelete(req.params.id);
        if (!client) return res.status(404).json({ message: "Client not found" });
        res.status(200).json({ success: true, message: "Client deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: "Internal server error" });
    }
};

exports.registerAdmin = async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const existing = await Admin.findOne({ email });
        if (existing) return res.status(400).json({ message: "Admin already exists" });
        const hashedPassword = await bcrypt.hash(password, 10);
        const admin = await Admin.create({ name, email, password: hashedPassword });
        res.status(200).json({ success: true, message: "Admin registered successfully", admin });
    } catch (error) {
        res.status(500).json({ message: "Internal server error" });
    }
};

exports.registerClient = async (req, res) => {
    try {
        const { name, email, password, businessName, websiteUrl, city, pincode, gstNo, panNo, aadharNo } = req.body;
        const existing = await Client.findOne({ email });
        if (existing) return res.status(400).json({ message: "Client already exists" });
        const hashedPassword = await bcrypt.hash(password, 10);
        const client = await Client.create({
            name, email, password: hashedPassword, businessName,
            websiteUrl, city, pincode, gstNo, panNo,
            businessLogoKey: 'default', businessLogoUrl: 'default',
            mobileNo: '0000000000', address: 'N/A'
        });
        res.status(200).json({ success: true, message: "Client registered successfully", client });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Internal server error" });
    }
};