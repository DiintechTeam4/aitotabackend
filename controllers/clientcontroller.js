const Client = require("../models/Client");
const HumanAgent = require("../models/HumanAgent");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { getobject, putobject } = require("../utils/s3");
const { OAuth2Client } = require("google-auth-library");

// Initialize Google OAuth2 client
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

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

    let code; 
    
    if (client.isprofileCompleted && client.isApproved) {
      code = 202;  
    } else if (client.isprofileCompleted && !client.isApproved) {
      code = 203; 
    }

    res.status(200).json({
      success: true,
      token: jwtToken,
      client: {
        _id: client._id,
        name: client.name,
        email: client.email,
        code: code,
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
    const userEmail = email.toLowerCase();
    console.log('Google login attempt for email:', userEmail);

    // Step 1: Check if email exists as human agent FIRST (Priority)
    const humanAgent = await HumanAgent.findOne({ 
      email: userEmail 
    }).populate('clientId');

    if (humanAgent) {
      console.log('Human agent found:', humanAgent._id);
      
      // Check if human agent is approved
      if (!humanAgent.isApproved) {
        console.log('Human agent not approved:', humanAgent._id);
        return res.status(401).json({ 
          success: false, 
          message: "Your human agent account is not yet approved. Please contact your administrator." 
        });
      }

      // Get client information
      const client = await Client.findById(humanAgent.clientId);
      if (!client) {
        console.log('Client not found for human agent:', humanAgent._id);
        return res.status(401).json({ 
          success: false, 
          message: "Associated client not found" 
        });
      }

      console.log('Human agent Google login successful:', humanAgent._id);

      // Generate token for human agent
      const jwtToken = jwt.sign(
        { 
          id: humanAgent._id, 
          userType: 'humanAgent',
          clientId: client._id,
          email: humanAgent.email
        }, 
        process.env.JWT_SECRET, 
        { expiresIn: "7d" }
      );

      // Return response in the exact format you specified
      return res.status(200).json({
        success: true,
        message: "Profile incomplete",
        token: jwtToken,
        userType: "humanAgent",
        isprofileCompleted: humanAgent.isprofileCompleted || false,
        id: humanAgent._id,
        email: humanAgent.email,
        name: humanAgent.humanAgentName,
        isApproved: humanAgent.isApproved || false
      });
    }

    // Step 2: If not human agent, check if email exists as client
    let client = await Client.findOne({ email: userEmail });

    if (client) {
      console.log('Client found:', client._id);
      // Existing client
      const token = generateToken(client._id);

      if (client.isprofileCompleted === true || client.isprofileCompleted === "true") {
        // Profile completed, proceed with login
        return res.status(200).json({
          success: true,
          message: "Profile incomplete",
          token,
          userType: "client",
          isprofileCompleted: true,
          id: client._id,
          email: client.email,
          name: client.name,
          isApproved: client.isApproved || false
        });
      } else {
        // Profile not completed - return in exact format you specified
        return res.status(200).json({
          success: true,
          message: "Profile incomplete",
          token,
          userType: "client",
          isprofileCompleted: false,
          id: client._id,
          email: client.email,
          name: client.name,
          isApproved: client.isApproved || false
        });
      }
    } else {
      // Step 3: New client, create with Google info
      console.log('Creating new client for email:', userEmail);
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
        userType: "client",
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
    if(businessLogoKey) {
      businessLogoUrl = await getobject(businessLogoKey);
    }

    // Check if the token is from admin
    if (req.admin) {
      // Admin is creating the client - auto approve
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
        isprofileCompleted: true,
        isApproved: true
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
          businesslogoKey: client.businessLogoKey,
          businessLogoUrl: client.businessLogoUrl,
          gstNo: client.gstNo,
          panNo: client.panNo,
          mobileNo: client.mobileNo,
          address: client.address,
          city: client.city,
          pincode: client.pincode,
          websiteUrl: client.websiteUrl,
          isprofileCompleted: true,
          isApproved: true
        }
      });
    } else {
      // Non-admin registration - requires approval
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
        isprofileCompleted: true,
        isApproved: false
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
          businesslogoKey: client.businessLogoKey,
          businessLogoUrl: client.businessLogoUrl,
          gstNo: client.gstNo,
          panNo: client.panNo,
          mobileNo: client.mobileNo,
          address: client.address,
          city: client.city,
          pincode: client.pincode,
          websiteUrl: client.websiteUrl,
          isprofileCompleted: true,
          isApproved: false
        }
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ==================== HUMAN AGENT FUNCTIONS ====================

// Get all human agents for a client
const getHumanAgents = async (req, res) => {
  try {
    // Extract clientId from token
    const clientId = req.clientId;
    
    // Verify client exists
    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({ 
        success: false, 
        message: "Client not found" 
      });
    }

    const humanAgents = await HumanAgent.find({ clientId })
      .populate('agentIds', 'agentName description')
      .sort({ createdAt: -1 });

    res.json({ 
      success: true, 
      data: humanAgents 
    });
  } catch (error) {
    console.error("Error fetching human agents:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to fetch human agents" 
    });
  }
};

// Create new human agent
const createHumanAgent = async (req, res) => {
  try {
    // Extract clientId from token
    const clientId = req.clientId;
    const { humanAgentName, email, mobileNumber, did } = req.body;

    // Validate required fields
    if (!humanAgentName || !email || !mobileNumber || !did) {
      return res.status(400).json({ 
        success: false, 
        message: "Human agent name, email, mobile number, and DID are required" 
      });
    }

    console.log(clientId);

    // Verify client exists
    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({ 
        success: false, 
        message: "Client not found" 
      });
    }

    // Check if human agent with same name already exists for this client
    const existingAgent = await HumanAgent.findOne({ 
      clientId, 
      humanAgentName: humanAgentName.trim() 
    });
    
    if (existingAgent) {
      return res.status(400).json({ 
        success: false, 
        message: "Human agent with this name already exists for this client" 
      });
    }

    // Check if email already exists
    const existingEmail = await HumanAgent.findOne({ email: email.toLowerCase() });
    if (existingEmail) {
      return res.status(400).json({ 
        success: false, 
        message: "Email already registered" 
      });
    }

    const humanAgent = new HumanAgent({
      clientId,
      humanAgentName: humanAgentName.trim(),
      email: email.toLowerCase().trim(),
      mobileNumber: mobileNumber.trim(),
      did: did.trim(),
      isprofileCompleted: true,
      isApproved: true,
      agentIds: [] // Initially empty array
    });

    await humanAgent.save();

    res.status(201).json({ 
      success: true, 
      data: humanAgent,
      message: "Human agent created successfully" 
    });
  } catch (error) {
    console.error("Error creating human agent:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to create human agent" 
    });
  }
};

// Update human agent
const updateHumanAgent = async (req, res) => {
  try {
    // Extract clientId from token
    const clientId = req.clientId;
    const { agentId } = req.params;
    const { humanAgentName, email, mobileNumber, did} = req.body;

    // Verify client exists
    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({ 
        success: false, 
        message: "Client not found" 
      });
    }

    // Find and update human agent
    const humanAgent = await HumanAgent.findOneAndUpdate(
      { _id: agentId, clientId },
      {
        humanAgentName: humanAgentName?.trim(),
        email: email?.toLowerCase().trim(),
        mobileNumber: mobileNumber?.trim(),
        did: did?.trim(),
        updatedAt: new Date()
      },
      { new: true, runValidators: true }
    );

    if (!humanAgent) {
      return res.status(404).json({ 
        success: false, 
        message: "Human agent not found" 
      });
    }

    res.json({ 
      success: true, 
      data: humanAgent,
      message: "Human agent updated successfully" 
    });
  } catch (error) {
    console.error("Error updating human agent:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to update human agent" 
    });
  }
};

// Delete human agent
const deleteHumanAgent = async (req, res) => {
  try {
    // Extract clientId from token
    const clientId = req.user.id;
    const { agentId } = req.params;

    // Verify client exists
    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({ 
        success: false, 
        message: "Client not found" 
      });
    }

    const humanAgent = await HumanAgent.findOneAndDelete({ 
      _id: agentId, 
      clientId 
    });

    if (!humanAgent) {
      return res.status(404).json({ 
        success: false, 
        message: "Human agent not found" 
      });
    }

    res.json({ 
      success: true, 
      message: "Human agent deleted successfully" 
    });
  } catch (error) {
    console.error("Error deleting human agent:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to delete human agent" 
    });
  }
};

// Get single human agent
const getHumanAgentById = async (req, res) => {
  try {
    // Extract clientId from token
    const clientId = req.clientId;
    const { agentId } = req.params;

    // Verify client exists
    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({ 
        success: false, 
        message: "Client not found" 
      });
    }

    const humanAgent = await HumanAgent.findOne({ 
      _id: agentId, 
      clientId 
    }).populate('agentIds', 'agentName description');

    if (!humanAgent) {
      return res.status(404).json({ 
        success: false, 
        message: "Human agent not found" 
      });
    }

    res.json({ 
      success: true, 
      data: humanAgent 
    });
  } catch (error) {
    console.error("Error fetching human agent:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to fetch human agent" 
    });
  }
};

// Human Agent Login
const loginHumanAgent = async (req, res) => {
  try {
    const { email, clientEmail } = req.body;

    console.log('Human agent login attempt for email:', email, 'clientEmail:', clientEmail);

    if (!email || !clientEmail) {
      console.log('Missing credentials for human agent login');
      return res.status(400).json({
        success: false,
        message: "Email and Client Email are required"
      });
    }

    // First verify the client exists by email
    const client = await Client.findOne({ email: clientEmail.toLowerCase() });
    if (!client) {
      console.log('Client not found for clientEmail:', clientEmail);
      return res.status(401).json({ 
        success: false, 
        message: "Invalid Client Email" 
      });
    }

    // Check if human agent exists with this email and clientId
    const humanAgent = await HumanAgent.findOne({ 
      email: email.toLowerCase(),
      clientId: client._id 
    });

    if (!humanAgent) {
      console.log('Human agent not found for email:', email, 'clientId:', client._id);
      return res.status(401).json({ 
        success: false, 
        message: "Human agent not found. Please check your email and Client Email." 
      });
    }

    // Check if human agent is approved
    if (!humanAgent.isApproved) {
      console.log('Human agent not approved:', humanAgent._id);
      return res.status(401).json({ 
        success: false, 
        message: "Your account is not yet approved. Please contact your administrator." 
      });
    }

    console.log('Human agent login successful:', humanAgent._id);

    // Generate token for human agent
    const token = jwt.sign(
      { 
        id: humanAgent._id, 
        userType: 'humanAgent',
        clientId: client._id,
        email: humanAgent.email
      }, 
      process.env.JWT_SECRET, 
      { expiresIn: "7d" }
    );

    res.json({
      success: true,
      message: "Human agent login successful",
      token,
      humanAgent: {
        _id: humanAgent._id,
        humanAgentName: humanAgent.humanAgentName,
        email: humanAgent.email,
        mobileNumber: humanAgent.mobileNumber,
        did: humanAgent.did,
        isprofileCompleted: humanAgent.isprofileCompleted,
        isApproved: humanAgent.isApproved,
        clientId: humanAgent.clientId,
        agentIds: humanAgent.agentIds
      },
      client: {
        _id: client._id,
        clientName: client.clientName,
        email: client.email
      }
    });

  } catch (error) {
    console.error("Error in human agent login:", error);
    res.status(500).json({
      success: false,
      message: "Login failed. Please try again."
    });
  }
};

// Human Agent Google Login
const loginHumanAgentGoogle = async (req, res) => {
  try {
    const { token } = req.body;

    console.log('Human agent Google login attempt');

    if (!token) {
      console.log('Missing Google token for human agent login');
      return res.status(400).json({
        success: false,
        message: "Google token is required"
      });
    }

    // Verify Google token and extract email
    try {
      const audience = [process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_ANDROID_CLIENT_ID].filter(Boolean);
      console.log('Audience for Google verification:', audience);
      
      // Verify the Google ID token
      const ticket = await googleClient.verifyIdToken({
        idToken: token,
        audience: audience,
      });

      const payload = ticket.getPayload();
      console.log('Google token verified, payload:', payload);
      
      if (!payload || !payload.email) {
        console.log('Invalid Google token or missing email');
        return res.status(401).json({ 
          success: false, 
          message: "Invalid Google token" 
        });
      }

      const humanAgentEmail = payload.email.toLowerCase();
      console.log('Looking for human agent with email:', humanAgentEmail);

      // Find human agent with this email
      const humanAgent = await HumanAgent.findOne({ 
        email: humanAgentEmail 
      }).populate('clientId');

          if (!humanAgent) {
        console.log('Human agent not found for email:', humanAgentEmail);
        return res.status(401).json({ 
          success: false, 
          message: "Human agent not found. Please contact your administrator to register your email." 
        });
      }

      // Check if human agent is approved
      if (!humanAgent.isApproved) {
        console.log('Human agent not approved:', humanAgent._id);
        return res.status(401).json({ 
          success: false, 
          message: "Your account is not yet approved. Please contact your administrator." 
        });
      }

      // Get client information
      const client = await Client.findById(humanAgent.clientId);
      if (!client) {
        console.log('Client not found for human agent:', humanAgent._id);
        return res.status(401).json({ 
          success: false, 
          message: "Associated client not found" 
        });
      }

      console.log('Human agent Google login successful:', humanAgent._id);

      // Generate token for human agent
      const jwtToken = jwt.sign(
        { 
          id: humanAgent._id, 
          userType: 'humanAgent',
          clientId: client._id,
          email: humanAgent.email
        }, 
        process.env.JWT_SECRET, 
        { expiresIn: "7d" }
      );

      res.json({
        success: true,
        message: "Human agent Google login successful",
        token: jwtToken,
        humanAgent: {
          _id: humanAgent._id,
          humanAgentName: humanAgent.humanAgentName,
          email: humanAgent.email,
          mobileNumber: humanAgent.mobileNumber,
          did: humanAgent.did,
          isprofileCompleted: humanAgent.isprofileCompleted,
          isApproved: humanAgent.isApproved,
          clientId: humanAgent.clientId,
          agentIds: humanAgent.agentIds
        },
        client: {
          _id: client._id,
          clientName: client.clientName,
          email: client.email
        }
      });

    } catch (googleError) {
      console.error('Google token verification error:', googleError);
      return res.status(401).json({
        success: false,
        message: "Invalid Google token"
      });
    }

  } catch (error) {
    console.error("Error in human agent Google login:", error);
    res.status(500).json({
      success: false,
      message: "Google login failed. Please try again."
    });
  }
};

module.exports = { 
  getUploadUrl,
  loginClient, 
  googleLogin,
  registerClient,
  getClientProfile,
  getHumanAgents,
  createHumanAgent,
  updateHumanAgent,
  deleteHumanAgent,
  getHumanAgentById,
  loginHumanAgent,
  loginHumanAgentGoogle
};
