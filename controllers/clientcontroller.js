const Client = require("../models/Client");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { getobject, putobject } = require("../utils/s3");
const { GoogleAuth } = require("google-auth-library");

// Generate JWT Token
const generateToken = (id) => {
  return jwt.sign({ id, userType: 'client' }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
};

const getUploadUrl = async (req, res) => {
  try {
    const { fileName, fileType } = req.query;
    if (!fileName || !fileType) {
      return res.status(400).json({ success: false, message: 'fileName and fileType are required' });
    }
    const key = `businessLogo/${Date.now()}_${fileName}`;
    const url = await putobject(key, fileType);
    res.json({ success: true, url, key });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getClientProfile = async (req, res) => {
  try {
    const clientId = req.user.id;
    const client = await Client.findById(clientId).select('-password');
    if (!client) {
      return res.status(404).json({
        success: false,
        message: "Client not found"
      });
    }
    let businessLogoUrl = '';
    if (client.businessLogoKey) {
      businessLogoUrl = await getobject(client.businessLogoKey);
    }
    res.status(200).json({
      success: true,
      data: {
        ...client.toObject(),
        businessLogoUrl
      }
    });
  } catch (error) {
    console.error('Error fetching client profile:', error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch client profile"
    });
  }
};

// Login client
const loginClient = async (req, res) => {
  try {
    const { email, password } = req.body;

    
    // Regular email/password login
    console.log('Regular login attempt for client with email:', email);

    if (!email || !password) {
      console.log('Missing credentials');
      return res.status(400).json({
        success: false,
        message: "Email and password are required"
      });
    }

    // Check if client exists
    const client = await Client.findOne({ email });
    if (!client) {
      console.log('Client not found for email:', email);
      return res.status(401).json({ 
        success: false, 
        message: "Invalid email or password" 
      });
    }

    console.log('Client found, verifying password');

    // Check if password matches
    const isPasswordValid = await bcrypt.compare(password, client.password);
    if (!isPasswordValid) {
      console.log('Invalid password for client email:', email);
      return res.status(401).json({ 
        success: false, 
        message: "Invalid email or password" 
      });
    }

    console.log('Password verified, generating token');

    // Generate token with userType
    const jwtToken = jwt.sign(
      { 
        id: client._id,
        userType: 'client'
      }, 
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    console.log('Login successful for client email:', email);

    // let responseStatus = 200; 
    
    // if (client.isprofileCompleted && client.isApproved) {
    //   responseStatus = 202;  
    // } else if (client.isprofileCompleted && !client.isApproved) {
    //   responseStatus = 203; 
    // }

    res.status(200).json({
      success: true,
      token: jwtToken,
      client: {
        _id: client._id,
        name: client.name,
        email: client.email,
        businessName: client.businessName,
        gstNo: client.gstNo,
        panNo: client.panNo,
        mobileNo: client.mobileNo,
        address: client.address,
        city: client.city,
        pincode: client.pincode,
        websiteUrl: client.websiteUrl,
        isApproved: client.isApproved || false,
        isprofileCompleted: client.isprofileCompleted || false
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || "An error occurred during login"
    });
  }
};


const googleLogin = async (req, res) => {
  try {
    // googleUser is set by verifyGoogleToken middleware
    const { email, name, picture, emailVerified, googleId } = req.googleUser;

    // Find client by email
    let client = await Client.findOne({ email });

    if (client) {
      // Existing client
      const token = generateToken(client._id);

      if (client.isprofileCompleted === true || client.isprofileCompleted === "true") {
        // Profile completed, proceed with login
    //     let responseStatus = 200; 
    
    // if (client.isprofileCompleted && client.isApproved) {
    //   responseStatus = 202; 
    // } else if (client.isprofileCompleted && !client.isApproved) {
    //   responseStatus = 203; 
    // }
        return res.status(200).json({
          success: true,
          token,
          client: {
            id: client._id,
            name: client.name,
            email: client.email,
            businessName: client.businessName,
            businessLogoKey: client.businessLogoKey,
            businessLogoUrl: client.businessLogoUrl,
            gstNo: client.gstNo,
            panNo: client.panNo,
            mobileNo: client.mobileNo,
            address: client.address,
            city: client.city,
            pincode: client.pincode,
            websiteUrl: client.websiteUrl,
            isprofileCompleted: client.isprofileCompleted,
            isGoogleUser: client.isGoogleUser,
            googlePicture: client.googlePicture,
            emailVerified: client.emailVerified,
            userId: client.userId,
            isApproved: client.isApproved || false
          }
        });
      } 
      else {
    //     let responseStatus = 200; 
    
    // if (client.isprofileCompleted && client.isApproved) {
    //   responseStatus = 202; 
    // } else if (client.isprofileCompleted && !client.isApproved) {
    //   responseStatus = 203; 
    // }
        // Profile not completed
        return res.status(200).json({
          success: true,
          message: "Profile incomplete",
          token,
          isprofileCompleted: false,
          id: client._id,
          email: client.email,
          name: client.name,
          isApproved: client.isApproved || false
          
        });
      }
    } else {
      // New client, create with Google info, isprofileCompleted: false
      const newClient = await Client.create({
        name,
        email,
        password: "", // No password for Google user
        isGoogleUser: true,
        googleId,
        googlePicture: picture,
        emailVerified,
        isprofileCompleted: false,
        isApproved: false
      });
      const token = generateToken(newClient._id)

      return res.status(200).json({
        success: true,
        message: "Profile incomplete",
        token,
        isprofileCompleted: false,
        id: newClient._id,
        email: newClient.email,
        name: newClient.name,
        isApproved: newClient.isApproved || false
      });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Google login failed" });
  }
};

// Register new client
const registerClient = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      businessName,
      businessLogoKey,
      gstNo,
      panNo,
      mobileNo,
      address,
      city,
      pincode,
      websiteUrl
    } = req.body;

    // Check if client email already exists
    const existingClient = await Client.findOne({ email });
    if (existingClient) {
      return res.status(400).json({
        success: false,
        message: "Email already registered"
      });
    }

    // Check if client already exists with the same GST/PAN/MobileNo
    const existingBusinessClient = await Client.findOne({
      $or: [
        { gstNo },
        { panNo },
        { mobileNo }
      ]
    });

    if (existingBusinessClient) {
      return res.status(400).json({
        success: false,
        message: "Client already exists with the same GST, PAN, or Mobile number"
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    let businessLogoUrl = "";
    if(businessLogoKey)
    {
      businessLogoUrl = await getobject(businessLogoKey);
    }

    // Create new client
    const client = await Client.create({
      name,
      email,
      password: hashedPassword,
      businessName,
      businessLogoKey,
      businessLogoUrl,
      gstNo,
      panNo,
      mobileNo,
      address,
      city,
      pincode,
      websiteUrl,
      isprofileCompleted:true
    });

    // Generate token
    const token = generateToken(client._id);

    res.status(201).json({
      success: true,
      token,
      client: {
        _id: client._id,
        name: client.name,
        email: client.email,
        businessName: client.businessName,
        businesslogoKey:client.businessLogoKey,
        businessLogoUrl:client.businessLogoUrl,
        gstNo: client.gstNo,
        panNo: client.panNo,
        mobileNo: client.mobileNo,
        address: client.address,
        city: client.city,
        pincode: client.pincode,
        websiteUrl: client.websiteUrl,
        isprofileCompleted:true
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

module.exports = { 
  getUploadUrl,
  loginClient, 
  googleLogin,
  registerClient,
  getClientProfile,
};
