const Admin = require("../models/Admin");
const bcrypt=require("bcrypt");
const jwt = require('jsonwebtoken');
const Client = require("../models/Client");
const Agent = require("../models/Agent");
const { getobject } = require("../utils/s3");


// Generate JWT Token for admin
const generateAdminToken = (id) => {
  return jwt.sign(
    { 
      id,
      userType: 'admin' // Explicitly set userType
    }, 
    process.env.JWT_SECRET, 
    {
      expiresIn: '7d'
    }
  );
};

const loginAdmin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required"
      });
    }

    // Check if admin exists
    const admin = await Admin.findOne({ email });
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    // Check if password matches
    const isPasswordValid = await bcrypt.compare(password, admin.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    // Generate token with userType
    const token = jwt.sign(
      { 
        id: admin._id,
        userType: 'admin'
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(200).json({
      success: true,
      token,
      admin: {
        _id: admin._id,
        name: admin.name,
        email: admin.email
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

const registerAdmin = async (req, res) => {
    try {
        const { name, email, password, admincode } = req.body;

        if(admincode!= process.env.ADMIN_REGISTRATION_CODE){
            console.log(admincode,process.env.ADMIN_REGISTRATION_CODE)
            return res.status(401).json({ message: 'Invalid admin code' });
        }

        const existingadmin=await Admin.findOne({email});
        if(existingadmin){
            return res.status(400).json({ message: 'Admin already exists' });
        }

         // Hash password before saving
         const salt = await bcrypt.genSalt(10);
         const hashedPassword = await bcrypt.hash(password, salt);
 
        const admin = await Admin.create({ name, email, password:hashedPassword });
        const token=generateAdminToken(admin._id);

        res.status(201).json({
            success: true,
            token,
            user: {
                _id: admin._id,
                name: admin.name,
                email: admin.email,
                password:hashedPassword,
                admincode:admin.admincode
            }
        }); 
       } 
    catch (error) {
        res.status(500).json({ message: error.message });
    }
    
}
const getClients = async (req, res) => {
    try {
      const clients = await Client.find().select('-password');

      const clientsWithLogos = await Promise.all(
        clients.map(async (c) => {
          const clientObj = c.toObject();
          try {
            if (clientObj.businessLogoKey) {
              clientObj.businessLogoUrl = await getobject(clientObj.businessLogoKey);
            }
          } catch (e) {
            // If URL generation fails, fall back to existing or null
            clientObj.businessLogoUrl = clientObj.businessLogoUrl || null;
          }
          return clientObj;
        })
      );

      res.status(200).json({
        success: true,
        count: clientsWithLogos.length,
        data: clientsWithLogos
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  };
  
  // Get client profile by ID
  const getClientById = async (req, res) => {
    try {
      const client = await Client.findById(req.params.id).select('-password');
      
      if (!client) {
        return res.status(404).json({
          success: false,
          message: "Client not found"
        });
      }
      
      const clientObj = client.toObject();
      try {
        if (clientObj.businessLogoKey) {
          clientObj.businessLogoUrl = await getobject(clientObj.businessLogoKey);
        }
      } catch (e) {
        clientObj.businessLogoUrl = clientObj.businessLogoUrl || null;
      }

      res.status(200).json({
        success: true,
        data: clientObj
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  };

  const registerclient = async (req, res) => {
    try {
      const {
        name,
        email,
        password,
        businessName,
        websiteUrl,
        city,
        pincode,
        gstNo,
        panNo,
        aadharNo
      } = req.body;
  
      // Check if client already exists
      const existingClient = await Client.findOne({ email });
      if (existingClient) {
        return res.status(400).json({
          success: false,
          message: "Client with this email already exists"
        });
      }
  
      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);
  
      // Create new client
      const client = await Client.create({
        name,
        email,
        password: hashedPassword,
        businessName,
        websiteUrl,
        city,
        pincode,
        gstNo,
        panNo,
        aadharNo
      });

      // Initialize default credits (100) for new client
      try {
        const Credit = require("../models/Credit");
        const creditRecord = await Credit.getOrCreateCreditRecord(client._id);
        if ((creditRecord?.currentBalance || 0) === 0) {
          await creditRecord.addCredits(100, 'bonus', 'Welcome bonus credits');
        }
      } catch (e) {
        console.error('Failed to initialize default credits for client:', e.message);
      }
  
      // Remove password from response
      const clientResponse = client.toObject();
      delete clientResponse.password;
  
      res.status(201).json({
        success: true,
        message: "Client created successfully",
        data: clientResponse
      });
    } catch (error) {
      console.error('Error creating client:', error);
      res.status(500).json({
        success: false,
        message: "Failed to create client"
      });
    }
  };

  const deleteclient = async(req, res) => {
    try {
        const id = req.params.id;
        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Client ID is required"
            });
        }
  
        const client = await Client.findByIdAndDelete(id);
        if (!client) {
            return res.status(404).json({
                success: false,
                message: "Client not found"
            });
        }
  
        res.status(200).json({
            success: true,
            message: "Client deleted successfully"
        });
    } catch (error) {
        console.error('Error deleting client:', error);
        res.status(500).json({
            success: false,
            message: "Failed to delete client"
        });
    }
  }

// Get client token for admin access
const getClientToken = async (req, res) => {
  try {
    const { clientId } = req.params;
    const adminId = req.user.id;

    console.log('getClientToken called with:', {
      clientId,
      adminId,
      userType: req.user.userType
    });

    // Verify admin exists and is authenticated
    if (req.user.userType !== 'admin') {
      console.log('Invalid user type:', req.user.userType);
      return res.status(401).json({ message: 'Only admins can access client tokens' });
    }

    const admin = await Admin.findById(adminId);
    if (!admin) {
      console.log('Admin not found:', adminId);
      return res.status(401).json({ message: 'Admin not found' });
    }
    console.log('Admin verified:', admin.email);

    // Get client details
    const client = await Client.findById(clientId);
    if (!client) {
      console.log('Client not found:', clientId);
      return res.status(404).json({ message: 'Client not found' });
    }
    console.log('Client found:', client.email);

    // Generate token for client with admin access flag
    const token = jwt.sign(
      { 
        id: client._id,
        email: client.email,
        userType: 'client',
        adminAccess: true, // Flag to indicate this is admin-accessed client session
        adminId: adminId // Store admin ID for tracking
      },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    console.log('Generated client token for:', client.email);
    res.json({ token });
  } catch (error) {
    console.error('Error in getClientToken:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Approve client (set isApproved to true)
const approveClient = async (req, res) => {
  try {
    const { clientId } = req.params;
    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }
    client.isApproved = true;
    await client.save();
    res.status(200).json({ success: true, message: 'Client approved successfully', client });
  } catch (error) {
    console.error('Error approving client:', error);
    res.status(500).json({ success: false, message: 'Failed to approve client' });
  }
};

// Get all agents from all clients
const getAllAgents = async (req, res) => {
  try {
    
    const agents = await Agent.find()
      .populate('clientId', 'name businessName')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: agents
    });
  } catch (error) {
    console.error('Error fetching all agents:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch agents'
    });
  }
};

// Toggle agent status (enable/disable)
const toggleAgentStatus = async (req, res) => {
  try {
    const { agentId } = req.params;
    
    if (!agentId) {
      return res.status(400).json({
        success: false,
        message: 'Agent ID is required'
      });
    }

    
    // Find the agent first to get current status
    const currentAgent = await Agent.findById(agentId);
    if (!currentAgent) {
      return res.status(404).json({
        success: false,
        message: 'Agent not found'
      });
    }

    // Toggle the status
    const newStatus = !currentAgent.isActive;
    
    // Update the agent
    const agent = await Agent.findByIdAndUpdate(
      agentId,
      { isActive: newStatus },
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      message: `Agent ${newStatus ? 'enabled' : 'disabled'} successfully`,
      data: agent
    });
  } catch (error) {
    console.error('Error toggling agent status:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to toggle agent status'
    });
  }
};

// Delete agent
const deleteAgent = async (req, res) => {
  try {
    const { agentId } = req.params;
    
    if (!agentId) {
      return res.status(400).json({
        success: false,
        message: 'Agent ID is required'
      });
    }

    
    // Find the agent first
    const agent = await Agent.findById(agentId);
    if (!agent) {
      return res.status(404).json({
        success: false,
        message: 'Agent not found'
      });
    }

    // Delete the agent
    await Agent.findByIdAndDelete(agentId);

    res.status(200).json({
      success: true,
      message: 'Agent deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting agent:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to delete agent'
    });
  }
};

// Copy agent to another client
const copyAgent = async (req, res) => {
  try {
    const { agentId, targetClientId } = req.body;
    
    if (!agentId || !targetClientId) {
      return res.status(400).json({
        success: false,
        message: 'Agent ID and target client ID are required'
      });
    }

    
    // Verify the target client exists and is approved
    const targetClient = await Client.findById(targetClientId);
    if (!targetClient) {
      return res.status(404).json({
        success: false,
        message: 'Target client not found'
      });
    }
    
    if (!targetClient.isApproved) {
      return res.status(400).json({
        success: false,
        message: 'Target client is not approved'
      });
    }

    // Get the source agent
    const sourceAgent = await Agent.findById(agentId);
    if (!sourceAgent) {
      return res.status(404).json({
        success: false,
        message: 'Source agent not found'
      });
    }

    // Create a copy of the agent with new client ID
    const agentCopy = {
      ...sourceAgent.toObject(),
      _id: undefined, // Remove the original ID
      clientId: targetClientId,
      agentName: `${sourceAgent.agentName}`,
      isActive: false, // Start as inactive by default
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Remove any fields that shouldn't be copied
    delete agentCopy._id;
    delete agentCopy.__v;

    // Create the new agent
    const newAgent = await Agent.create(agentCopy);

    res.status(201).json({
      success: true,
      message: 'Agent copied successfully',
      data: newAgent
    });
  } catch (error) {
    console.error('Error copying agent:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to copy agent'
    });
  }
};

// Update agent
const updateAgent = async (req, res) => {
  try {
    const { agentId } = req.params;
    const updateData = req.body;

    // Remove fields that shouldn't be updated
    const allowedFields = [
      'agentName',
      'description', 
      'category',
      'personality',
      'language',
      'firstMessage',
      'systemPrompt',
      'sttSelection',
      'ttsSelection',
      'llmSelection',
      'voiceSelection',
      'contextMemory',
      'brandInfo',
      'startingMessages',
      'whatsappEnabled',
      'telegramEnabled',
      'emailEnabled',
      'smsEnabled',
      'whatsapplink',
      'whatsapp',
      'telegram',
      'email',
      'sms',
      // Telephony/provider fields
      'serviceProvider',
      'accountSid',
      'callingNumber',
      'callerId',
      'X_API_KEY',
      // SnapBX fields
      'didNumber',
      'accessToken',
      'accessKey'
    ];

    const filteredUpdateData = {};
    Object.keys(updateData).forEach(key => {
      if (allowedFields.includes(key)) {
        filteredUpdateData[key] = updateData[key];
      }
    });

    // Add updatedAt timestamp
    filteredUpdateData.updatedAt = new Date();

    const updatedAgent = await Agent.findByIdAndUpdate(
      agentId,
      filteredUpdateData,
      { new: true, runValidators: true }
    );

    if (!updatedAgent) {
      return res.status(404).json({
        success: false,
        message: "Agent not found"
      });
    }

    res.status(200).json({
      success: true,
      message: "Agent updated successfully",
      data: updatedAgent
    });

  } catch (error) {
    console.error('Error updating agent:', error);
    res.status(500).json({
      success: false,
      message: error.message || "An error occurred while updating the agent"
    });
  }
};

module.exports = { loginAdmin, registerAdmin,getClients,getClientById,registerclient,deleteclient,getClientToken, approveClient, getAllAgents, toggleAgentStatus, copyAgent, deleteAgent, updateAgent };
