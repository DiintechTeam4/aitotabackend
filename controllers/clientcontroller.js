const Client = require("../models/Client");
const HumanAgent = require("../models/HumanAgent");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { getobject, putobject } = require("../utils/s3");
const KnowledgeBase = require("../models/KnowledgeBase");
const axios = require('axios');
const { OAuth2Client } = require("google-auth-library");
const Profile = require("../models/Profile");

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

const getUploadUrlMyBusiness = async (req, res) => {
  try {
    const { fileName, fileType } = req.query;
    if (!fileName || !fileType) {
      return res.status(400).json({ success: false, message: 'fileName and fileType are required' });
    }
    const key = `mybusiness/${Date.now()}_${fileName}`;
    const url = await putobject(key, fileType);
    res.json({ success: true, url, key });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getUploadUrlCustomization = async (req, res) => {
  try {
    const { fileName, fileType } = req.query;
    if (!fileName || !fileType) {
      return res.status(400).json({ success: false, message: 'fileName and fileType are required' });
    }
    const key = `agentCustomization/${Date.now()}_${fileName}`;
    const url = await putobject(key, fileType);
    res.json({ success: true, url, key });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Knowledge Base: Generate presigned URL for uploading agent KB files
const getUploadUrlKnowledgeBase = async (req, res) => {
  try {
    const { fileName, fileType } = req.query;
    if (!fileName || !fileType) {
      return res.status(400).json({ success: false, message: 'fileName and fileType are required' });
    }
    const key = `agentKnowledgeBase/${Date.now()}_${fileName}`;
    const url = await putobject(key, fileType);
    res.json({ success: true, url, key });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Generic: Generate presigned GET URL for a given S3 key
const getFileUrlByKey = async (req, res) => {
  try {
    const { key } = req.query;
    if (!key || typeof key !== 'string') {
      return res.status(400).json({ success: false, message: 'key is required' });
    }
    const url = await getobject(key);
    // Redirect to the signed URL so browsers can open/download directly
    return res.redirect(url);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


// Knowledge Base CRUD operations

// Create knowledge base item
const createKnowledgeItem = async (req, res) => {
  try {
    const { agentId, type, title, description, content, tags } = req.body;
    const clientId = req.user.id;

    if (!agentId || !type || !title) {
      return res.status(400).json({ 
        success: false, 
        message: 'agentId, type, and title are required' 
      });
    }

    // Validate content based on type
    let validatedContent = {};
    switch (type) {
      case 'pdf':
        if (!content.s3Key) {
          return res.status(400).json({ 
            success: false, 
            message: 'S3 key is required for PDF files' 
          });
        }
        validatedContent = { s3Key: content.s3Key };
        break;
        
      case 'text':
        // Enforce S3 storage for text as .txt
        if (!content.s3Key) {
          return res.status(400).json({ 
            success: false, 
            message: 'S3 key is required for text files' 
          });
        }
        validatedContent = { s3Key: content.s3Key };
        break;
        
      case 'image':
        if (!content.imageKey) {
          return res.status(400).json({ 
            success: false, 
            message: 'S3 key is required for images' 
          });
        }
        validatedContent = { imageKey: content.imageKey };
        break;
        
      case 'youtube':
        if (!content.youtubeId && !content.youtubeUrl) {
          return res.status(400).json({ 
            success: false, 
            message: 'YouTube ID or URL is required' 
          });
        }
        validatedContent = { 
          youtubeId: content.youtubeId,
          youtubeUrl: content.youtubeUrl 
        };
        break;
        
      case 'link':
        if (!content.url) {
          return res.status(400).json({ 
            success: false, 
            message: 'URL is required for links' 
          });
        }
        validatedContent = { 
          url: content.url,
          linkText: content.linkText || content.url
        };
        break;
        
      case 'website':
        if (!content.url) {
          return res.status(400).json({ 
            success: false, 
            message: 'URL is required for websites' 
          });
        }
        validatedContent = { 
          url: content.url
        };
        break;
        
      default:
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid content type' 
        });
    }

    const knowledgeItem = new KnowledgeBase({
      agentId,
      clientId,
      type,
      title,
      description,
      content: validatedContent,
      tags: tags || [],
      fileMetadata: content.fileMetadata || {}
    });

    await knowledgeItem.save();

    res.status(201).json({
      success: true,
      data: knowledgeItem,
      message: 'Knowledge item created successfully'
    });

  } catch (error) {
    console.error('Error creating knowledge item:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// Embed (process) a knowledge base document via external RAG API
const embedKnowledgeItem = async (req, res) => {
  try {
    const { id } = req.params;
    const clientId = req.user.id;

    const item = await KnowledgeBase.findOne({ _id: id, clientId, isActive: true });
    if (!item) {
      return res.status(404).json({ success: false, message: 'Knowledge item not found' });
    }

    // Only PDF and image types currently rely on S3; links/websites/youtube could also be supported if URL exists
    let url = null;
    if (item.type === 'pdf' || item.type === 'image') {
      if (!item.content?.s3Key) {
        return res.status(400).json({ success: false, message: 'Missing S3 key for this item' });
      }
      // Generate a temporary GET URL
      try {
        url = await getobject(item.content.s3Key);
      } catch (e) {
        return res.status(500).json({ success: false, message: 'Failed to generate file URL' });
      }
    } else if (item.type === 'text' || item.type === 'link' || item.type === 'website' || item.type === 'youtube') {
      if (item.type === 'text') {
        if (!item.content?.s3Key) {
          return res.status(400).json({ success: false, message: 'Missing S3 key for this text item' });
        }
        try {
          url = await getobject(item.content.s3Key);
        } catch (e) {
          return res.status(500).json({ success: false, message: 'Failed to generate file URL' });
        }
      } else {
        url = item.content?.url || item.content?.youtubeUrl || null;
      }
      if (!url) {
        return res.status(400).json({ success: false, message: 'No URL available to embed for this item' });
      }
    } else {
      return res.status(400).json({ success: false, message: 'Embedding supported only for pdf/image/link/website/youtube' });
    }

    const payload = {
      url,
      book_name: String(item.agentId),
      chapter_name: String(item._id),
      client_id: String(clientId)
    };

    const ragUrl = 'https://vectrize.ailisher.com/api/v1/rag/process-document';
    const resp = await axios.post(ragUrl, payload, { headers: { 'Content-Type': 'application/json' }, timeout: 30000 });

    // Mark item as embedded with metadata
    item.isEmbedded = true;
    item.embeddedAt = new Date();
    const meta = resp?.data?.data || {};
    item.embedMeta = {
      message: meta.message,
      processedChunks: meta.processed_chunks,
      totalBatches: meta.total_batches,
      totalLatency: meta.total_latency,
      chunkingLatency: meta.chunking_latency,
      embeddingLatency: meta.embedding_latency
    };
    await item.save();

    res.json({ success: true, data: resp.data, message: 'Embedding completed' });
  } catch (error) {
    console.error('Error embedding knowledge item:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to embed knowledge item' });
  }
};

// Get knowledge base items for an agent
const getKnowledgeItems = async (req, res) => {
  try {
    const { agentId } = req.params;
    const { type } = req.query;
    const clientId = req.user.id;

    let query = { agentId, clientId, isActive: true };
    if (type) {
      query.type = type;
    }

    const knowledgeItems = await KnowledgeBase.find(query)
      .sort({ createdAt: -1 })
      .lean();

    // Generate URLs for items that need them
    const itemsWithUrls = await Promise.all(
      knowledgeItems.map(async (item) => {
        const itemObj = item.toObject ? item.toObject() : item;
        try {
          itemObj.contentUrl = await getContentUrl(itemObj);
        } catch (error) {
          console.error('Error generating URL for item:', item._id, error);
          itemObj.contentUrl = null;
        }
        return itemObj;
      })
    );

    res.json({
      success: true,
      data: itemsWithUrls
    });

  } catch (error) {
    console.error('Error fetching knowledge items:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// Update knowledge base item
const updateKnowledgeItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, content, tags } = req.body;
    const clientId = req.user.id;

    const knowledgeItem = await KnowledgeBase.findOne({ 
      _id: id, 
      clientId, 
      isActive: true 
    });

    if (!knowledgeItem) {
      return res.status(404).json({ 
        success: false, 
        message: 'Knowledge item not found' 
      });
    }

    // Update fields
    if (title) knowledgeItem.title = title;
    if (description !== undefined) knowledgeItem.description = description;
    if (content) {
      // Validate content based on type
      let validatedContent = {};
      switch (knowledgeItem.type) {
        case 'pdf':
          if (content.s3Key) validatedContent = { s3Key: content.s3Key };
          break;
        case 'text':
          if (content.s3Key) validatedContent = { s3Key: content.s3Key };
          break;
        case 'image':
          if (content.imageKey) validatedContent = { imageKey: content.imageKey };
          break;
        case 'youtube':
          validatedContent = { 
            youtubeId: content.youtubeId || knowledgeItem.content.youtubeId,
            youtubeUrl: content.youtubeUrl || knowledgeItem.content.youtubeUrl
          };
          break;
        case 'link':
          validatedContent = { 
            url: content.url || knowledgeItem.content.url,
            linkText: content.linkText || knowledgeItem.content.linkText
          };
          break;
      }
      if (Object.keys(validatedContent).length > 0) {
        knowledgeItem.content = { ...knowledgeItem.content, ...validatedContent };
      }
    }
    if (tags) knowledgeItem.tags = tags;

    await knowledgeItem.save();

    res.json({
      success: true,
      data: knowledgeItem,
      message: 'Knowledge item updated successfully'
    });

  } catch (error) {
    console.error('Error updating knowledge item:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// Delete knowledge base item
const deleteKnowledgeItem = async (req, res) => {
  try {
    const { id } = req.params;
    const clientId = req.user.id;

    const knowledgeItem = await KnowledgeBase.findOne({ 
      _id: id, 
      clientId, 
      isActive: true 
    });

    if (!knowledgeItem) {
      return res.status(404).json({ 
        success: false, 
        message: 'Knowledge item not found' 
      });
    }

    // Soft delete
    knowledgeItem.isActive = false;
    await knowledgeItem.save();

    res.json({
      success: true,
      message: 'Knowledge item deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting knowledge item:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// Helper function to get content URL
const getContentUrl = async (item) => {
  switch (item.type) {
    case 'pdf':
    case 'image':
      if (item.content.s3Key) {
        try {
          return await getobject(item.content.s3Key);
        } catch (error) {
          console.error('Error generating S3 URL:', error);
          return null;
        }
      }
      return null;
      
    case 'youtube':
      return item.content.youtubeUrl || `https://www.youtube.com/watch?v=${item.content.youtubeId}`;
      
    case 'link':
      return item.content.url;
      
    default:
      return null;
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
    console.log(isPasswordValid);
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

    // Get profile ID for client
    let profileId = await Profile.findOne({clientId: client._id});

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
        isprofileCompleted: client.isprofileCompleted || false,
        profileId: profileId ? profileId._id : null
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
    const loginType = req.body.loginType; // 'humanAgent' or undefined
    // googleUser is set by verifyGoogleToken middleware
    const { email, name, picture, emailVerified, googleId } = req.googleUser;
    const userEmail = email.toLowerCase();
    console.log('Google login attempt for email:', userEmail);

    if (loginType === 'humanAgent') {
      // Only check HumanAgent model
      const humanAgent = await HumanAgent.findOne({ email: userEmail }).populate('clientId');
      if (!humanAgent) {
        return res.status(404).json({
          success: false,
          message: "You are not registered as a human agent. Please contact your administrator."
        });
      }
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
      // Get profile information for human agent
      let humanAgentProfileId = await Profile.findOne({humanAgentId: humanAgent._id});
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
        userType: "executive",
        profileId: humanAgentProfileId ? humanAgentProfileId._id : null,
        isprofileCompleted: humanAgent.isprofileCompleted || false,
        id: humanAgent._id,
        email: humanAgent.email,
        name: humanAgent.humanAgentName,
        isApproved: humanAgent.isApproved || false
      });
    }

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
      // Get profile information for human agent
      let humanAgentProfileId = await Profile.findOne({humanAgentId: humanAgent._id});
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
        userType: "executive",
        profileId: humanAgentProfileId ? humanAgentProfileId._id : null,
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
      let profileId = await Profile.findOne({clientId: client._id});
      if (client.isprofileCompleted === true || client.isprofileCompleted === "true") {
        // Profile completed, proceed with login
        return res.status(200).json({
          success: true,
          message: "Profile incomplete",
          token,
          userType: "client",
          profileId: profileId ? profileId._id : null,
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
          profileId: profileId ? profileId._id : null,
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
      // Initialize default credits (100) for new client (Google sign-up)
      try {
        const Credit = require("../models/Credit");
        const creditRecord = await Credit.getOrCreateCreditRecord(newClient._id);
        if ((creditRecord?.currentBalance || 0) === 0) {
          await creditRecord.addCredits(100, 'bonus', 'Welcome bonus credits');
        }
      } catch (e) {
        console.error('Failed to initialize default credits for client (Google):', e.message);
      }
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

      // Telegram alert: client created by admin
      try {
        const { sendTelegramAlert } = require('../utils/telegramAlert');
        const when = new Date().toLocaleString('en-IN', { hour12: false });
        await sendTelegramAlert(`Client "${client.name || client.businessName || client.email}" is joined on ${when}.`);
      } catch (_) {}

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

      // Telegram alert: client self-registered
      try {
        const { sendTelegramAlert } = require('../utils/telegramAlert');
        const when = new Date().toLocaleString('en-IN', { hour12: false });
        await sendTelegramAlert(`Client "${client.name || client.businessName || client.email}" is joined on ${when}.`);
      } catch (_) {}

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
      .populate('agentIds', 'agentName description role')
      .sort({ createdAt: -1 });

    // Rename role -> type in response shape
    const data = humanAgents.map((doc) => {
      const obj = doc.toObject ? doc.toObject() : { ...doc };
      obj.type = obj.role;
      delete obj.role;
      return obj;
    });

    res.json({ 
      success: true, 
      data 
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
    const { humanAgentName, email, mobileNumber, agentIds, role } = req.body;

    // Validate required fields
    if (!humanAgentName || !email || !mobileNumber || !agentIds || agentIds.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: "Human agent name, email, mobile number, and at least one agent are required" 
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

    // Check if email already exists for THIS client (allow same email across different clients)
    const existingEmail = await HumanAgent.findOne({ 
      email: email.toLowerCase(), 
      clientId 
    });
    if (existingEmail) {
      return res.status(400).json({ 
        success: false, 
        message: "Email already registered for this client" 
      });
    }

    const humanAgent = new HumanAgent({
      clientId,
      humanAgentName: humanAgentName.trim(),
      email: email.toLowerCase().trim(),
      mobileNumber: mobileNumber.trim(),
      role: role || 'executive',
      isprofileCompleted: true,
      isApproved: true,
      agentIds: agentIds // Store all selected agent IDs
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
    const { humanAgentName, email, mobileNumber, agentIds, role} = req.body;

    // Verify client exists
    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({ 
        success: false, 
        message: "Client not found" 
      });
    }

    // If changing email, ensure uniqueness within this client
    if (email && typeof email === 'string') {
      const normalizedEmail = email.toLowerCase().trim();
      const conflict = await HumanAgent.findOne({
        clientId,
        email: normalizedEmail,
        _id: { $ne: agentId }
      });
      if (conflict) {
        return res.status(400).json({
          success: false,
          message: "Email already registered for this client"
        });
      }
    }

    // Find and update human agent
    const humanAgent = await HumanAgent.findOneAndUpdate(
      { _id: agentId, clientId },
      {
        humanAgentName: humanAgentName?.trim(),
        email: email?.toLowerCase().trim(),
        mobileNumber: mobileNumber?.trim(),
        role: role || 'executive',
        agentIds: agentIds || [], // Update agentIds array
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
    const clientId = req.clientId;
    const { agentId } = req.params;

    console.log('Delete request - clientId:', clientId, 'agentId:', agentId);

    // Verify client exists
    const client = await Client.findById(clientId);
    if (!client) {
      console.log('Client not found:', clientId);
      return res.status(404).json({ 
        success: false, 
        message: "Client not found" 
      });
    }

    // First check if human agent exists
    const existingAgent = await HumanAgent.findById(agentId);
    if (!existingAgent) {
      console.log('Human agent not found by ID:', agentId);
      return res.status(404).json({ 
        success: false, 
        message: "Human agent not found" 
      });
    }

    // Check if human agent belongs to this client
    if (existingAgent.clientId.toString() !== clientId.toString()) {
      console.log('Human agent does not belong to client. Agent clientId:', existingAgent.clientId, 'Request clientId:', clientId);
      return res.status(403).json({ 
        success: false, 
        message: "Access denied - human agent does not belong to this client" 
      });
    }

    // Delete the human agent
    const humanAgent = await HumanAgent.findOneAndDelete({ 
      _id: agentId, 
      clientId 
    });

    // Also delete the associated profile
    const deletedProfile = await Profile.findOneAndDelete({ 
      humanAgentId: agentId 
    });

    console.log('Deleted human agent:', humanAgent ? 'Yes' : 'No');
    console.log('Deleted associated profile:', deletedProfile ? 'Yes' : 'No');

    res.json({ 
      success: true, 
      message: "Human agent and associated profile deleted successfully" 
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

    // Get profile information for human agent and client
    let humanAgentProfileId = await Profile.findOne({humanAgentId: humanAgent._id});
    let clientProfileId = await Profile.findOne({clientId: client._id});

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
        agentIds: humanAgent.agentIds,
        profileId: humanAgentProfileId ? humanAgentProfileId._id : null
      },
      client: {
        _id: client._id,
        clientName: client.clientName,
        email: client.email,
        profileId: clientProfileId ? clientProfileId._id : null
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

      // Get profile information for human agent
      let humanAgentProfileId = await Profile.findOne({humanAgentId: humanAgent._id});
      let clientProfileId = await Profile.findOne({clientId: client._id});

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
          agentIds: humanAgent.agentIds,
          profileId: humanAgentProfileId ? humanAgentProfileId._id : null
        },
        client: {
          _id: client._id,
          clientName: client.clientName,
          email: client.email,
          profileId: clientProfileId ? clientProfileId._id : null
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

//switch api
const switchProfile = async (req, res) => {
  try {
    // Enforce: humanAgent tokens issued by client cannot switch
    try {
      const authHeaderRaw = req.headers.authorization || '';
      const previousToken = authHeaderRaw.startsWith('Bearer ') ? authHeaderRaw.split(' ')[1] : null;
      if (previousToken) {
        const decodedSwitch = jwt.verify(previousToken, process.env.JWT_SECRET);
        if (decodedSwitch && decodedSwitch.userType === 'humanAgent') {
          if (decodedSwitch.aud === 'humanAgent' && decodedSwitch.allowSwitch !== true) {
            return res.status(403).json({ success: false, message: 'Switch not allowed for this agent token' });
          }
        }
      }
    } catch (_) {
      // ignore decode failures
    }

    // Initialize or get tokens object from request body
    let tokens = req.body?.tokens || {
      adminToken: null,
      clientToken: null,
      humanAgentToken: null
    };

    // Resolve email like above
    let email = req.user?.email;
    if (!email) {
      if (req.user?.userType === 'admin') {
        const admin = await Admin.findById(req.user.id);
        email = admin?.email;
      } else if (req.user?.userType === 'client') {
        const client = await Client.findById(req.user.id);
        email = client?.email;
      } else if (req.user?.userType === 'humanAgent') {
        const ha = await HumanAgent.findById(req.user.id);
        email = ha?.email;
      }
    }
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email not available for current user' });
    }
    email = String(email).toLowerCase();

    // Accept full profile object or { role, id } or raw model objects
    let role = req.body?.role;
    let id = req.body?.id || req.body?._id;
    // If role missing, infer from body shape
    if (!role) {
      const b = req.body || {};
      // HumanAgent-like
      if (b.humanAgentName || b.agentIds || b.role === 'humanAgent' || b.clientId) {
        role = 'humanAgent';
        id = id || b.humanAgentId || b.id || b._id;
      }
      // Client-like
      else if (b.clientUserId || b.businessName || b.clientType || b.gstNo || b.panNo) {
        role = 'client';
        id = id || b.clientId || b.id || b._id;
      }
      // Admin-like
      else if (b.userType === 'admin') {
        role = 'admin';
        id = id || b.id || b._id;
      }
    }
    if (!role || !id) {
      return res.status(400).json({ success: false, message: 'role and id (or a profile object) are required' });
    }

    // CLIENT SWITCH
    if (role === 'client') {
      const client = await Client.findOne({ _id: id, email });
      if (!client) return res.status(404).json({ success: false, message: 'Client not found for this email' });
      if (!client.isApproved) return res.status(401).json({ success: false, message: 'Client not approved' });
      const sameEmailAdmin = await Admin.findOne({ email });
      const adminAccess = !!sameEmailAdmin;
      const adminId = sameEmailAdmin ? String(sameEmailAdmin._id) : undefined;
      const token = jwt.sign({ id: client._id, email: client.email, userType: 'client', adminAccess, adminId }, process.env.JWT_SECRET, { expiresIn: '7d' });
      const profileId = await Profile.findOne({ clientId: client._id });

      // Update tokens object - replace clientToken with new token
      tokens.clientToken = token;

      return res.json({
        success: true,
        token,
        tokens,
        userType: 'client',
        id: client._id,
        email: client.email,
        name: client.name,
        clientUserId: client.userId,
        adminAccess,
        adminId,
        isApproved: !!client.isApproved,
        isprofileCompleted: !!client.isprofileCompleted,
        profileId: profileId ? profileId._id : null
      });
    }

    // HUMAN AGENT SWITCH
    if (role === 'humanAgent') {
      // If called as client, validate by client context
      let humanAgent;
      if (req.user?.userType === 'client') {
        const clientIdCtx = req.user.id;
        humanAgent = await HumanAgent.findOne({ _id: id, clientId: clientIdCtx }).populate('clientId');
        if (!humanAgent) return res.status(404).json({ success: false, message: 'Human agent not found under this client' });
      } else {
        humanAgent = await HumanAgent.findOne({ _id: id, email }).populate('clientId');
        if (!humanAgent) return res.status(404).json({ success: false, message: 'Human agent not found for this email' });
      }
      if (!humanAgent.isApproved) return res.status(401).json({ success: false, message: 'Human agent not approved' });
      if (!humanAgent.clientId) return res.status(400).json({ success: false, message: 'Associated client not found' });

      const jwtToken = jwt.sign({
        id: humanAgent._id,
        userType: 'humanAgent',
        clientId: humanAgent.clientId._id,
        email: humanAgent.email,
        aud: 'humanAgent',
        allowSwitch: true
      }, process.env.JWT_SECRET, { expiresIn: '7d' });

      const humanAgentProfileId = await Profile.findOne({ humanAgentId: humanAgent._id });
      const clientProfileId = await Profile.findOne({ clientId: humanAgent.clientId._id });

      // Update tokens object - replace humanAgentToken with new token
      tokens.humanAgentToken = jwtToken;

      return res.json({
        success: true,
        token: jwtToken,
        tokens,
        userType: 'humanAgent',
        id: humanAgent._id,
        role: humanAgent.role,
        email: humanAgent.email,
        name: humanAgent.humanAgentName,
        isApproved: !!humanAgent.isApproved,
        isprofileCompleted: !!humanAgent.isprofileCompleted,
        clientId: humanAgent.clientId._id,
        clientUserId: humanAgent.clientId.userId,
        clientName: humanAgent.clientId.businessName || humanAgent.clientId.name || humanAgent.clientId.email,
        humanAgentProfileId: humanAgentProfileId ? humanAgentProfileId._id : null,
        clientProfileId: clientProfileId ? clientProfileId._id : null
      });
    }

    // ADMIN SWITCH
    if (role === 'admin') {
      const admin = await Admin.findOne({ _id: id, email });
      if (!admin) return res.status(404).json({ success: false, message: 'Admin not found for this email' });
      const token = jwt.sign({ id: admin._id, userType: 'admin', email: admin.email }, process.env.JWT_SECRET, { expiresIn: '7d' });

      // Update tokens object - replace adminToken with new token
      tokens.adminToken = token;

      return res.json({
        success: true,
        token,
        tokens,
        userType: 'admin',
        id: admin._id,
        email: admin.email,
        name: admin.name
      });
    }

    return res.status(400).json({ success: false, message: 'Invalid role' });
  } catch (error) {
    console.error('switchProfile error:', error);
    return res.status(500).json({ success: false, message: 'Failed to switch profile' });
  }
};

// Assign campaign history contacts (manual list or transcript range) to human agents
const assignCampaignHistoryContactsToHumanAgents = async (req, res) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 📋 ASSIGN: assignCampaignHistoryContactsToHumanAgents called`, {
    campaignId: req.params.id,
    runId: req.params.runId,
    humanAgentIds: req.body.humanAgentIds,
    transcriptRange: req.body.transcriptRange,
    contactIds: req.body.contactIds?.length || 0
  });

  const Campaign = require('../models/Campaign');
  const CampaignHistory = require('../models/CampaignHistory');
  const HumanAgent = require('../models/HumanAgent');
  const CallLog = require('../models/CallLog');

  const parseNumericValue = (value, allowNull = true) => {
    if (value === undefined || value === null || value === '') {
      return allowNull ? null : 0;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const buildHistoryContactFromDetail = (detail, contactsLookup) => {
    if (!detail || !detail.uniqueId) return null;
    const linkedContact = detail.contactId
      ? contactsLookup.get(String(detail.contactId))
      : null;

    return {
      documentId: detail.uniqueId,
      number: linkedContact?.phone || linkedContact?.number || detail.number || '',
      name: linkedContact?.name || detail.name || '',
      leadStatus:
        detail.leadStatus ||
        (detail.status === 'completed' ? 'connected' : 'not_connected'),
      contactId: detail.contactId ? String(detail.contactId) : '',
      time:
        detail.time instanceof Date
          ? detail.time.toISOString()
          : detail.time || new Date().toISOString(),
      status: detail.status || 'ringing',
      duration:
        typeof detail.callDuration === 'number' ? detail.callDuration : 0,
      transcriptCount:
        typeof detail.transcriptCount === 'number' ? detail.transcriptCount : 0,
      whatsappMessageSent: !!detail.whatsappMessageSent,
      whatsappRequested: !!detail.whatsappRequested,
      assignedToHumanAgents: []
    };
  };

  const ensureHistoryDocument = async (campaign, runId) => {
    let history = await CampaignHistory.findOne({
      campaignId: campaign._id,
      runId
    });

    if (history) return history;

    const detailsForRun = Array.isArray(campaign.details)
      ? campaign.details.filter((detail) => detail && detail.runId === runId)
      : [];

    if (detailsForRun.length === 0) {
      return null;
    }

    const contactsLookup = new Map(
      (campaign.contacts || []).map((contact) => [
        String(contact._id || contact.contactId || ''),
        contact
      ])
    );

    const contactsPayload = detailsForRun
      .map((detail) => buildHistoryContactFromDetail(detail, contactsLookup))
      .filter(Boolean);

    if (contactsPayload.length === 0) {
      return null;
    }

    const now = new Date();
    const startTime =
      detailsForRun[0]?.time instanceof Date
        ? detailsForRun[0].time
        : new Date(detailsForRun[0]?.time || now);
    const totalExistingRuns = await CampaignHistory.countDocuments({
      campaignId: campaign._id
    });

    // Calculate initial stats from contacts payload
    const successfulCalls = contactsPayload.filter(
      (c) => c.leadStatus && c.leadStatus !== 'not_connected'
    ).length;
    const failedCalls = contactsPayload.filter(
      (c) => !c.leadStatus || c.leadStatus === 'not_connected'
    ).length;
    const totalCallDuration = contactsPayload.reduce(
      (sum, c) => sum + (Number(c.duration) || Number(c.callDuration) || 0),
      0
    );
    const averageCallDuration =
      contactsPayload.length > 0
        ? Math.round(totalCallDuration / contactsPayload.length)
        : 0;

    history = await CampaignHistory.create({
      campaignId: campaign._id,
      runId,
      instanceNumber: totalExistingRuns + 1,
      startTime: startTime.toISOString(),
      endTime: now.toISOString(),
      runTime: { hours: 0, minutes: 0, seconds: 0 },
      status: campaign.isRunning ? 'running' : 'completed',
      contacts: contactsPayload,
      stats: {
        totalContacts: contactsPayload.length,
        successfulCalls,
        failedCalls,
        totalCallDuration,
        averageCallDuration
      }
    });

    return history;
  };

  const syncHistoryContactsFromDetails = async (history, campaign, runId) => {
    if (!history) {
      console.log(`🔄 SYNC: No history document found for runId ${runId}`);
      return null;
    }
    const existingDocIds = new Set(
      (history.contacts || [])
        .map((contact) => contact?.documentId)
        .filter(Boolean)
    );

    const detailsForRun = Array.isArray(campaign.details)
      ? campaign.details.filter(
          (detail) => detail && detail.runId === runId && detail.uniqueId
        )
      : [];

    console.log(`🔄 SYNC: Found ${detailsForRun.length} details for runId ${runId}, ${existingDocIds.size} existing contacts in history`);

    const newDetails = detailsForRun.filter(
      (detail) => !existingDocIds.has(detail.uniqueId)
    );
    if (newDetails.length === 0) {
      console.log(`✅ SYNC: No new contacts to sync for runId ${runId}`);
      return history;
    }
    
    console.log(`📥 SYNC: Syncing ${newDetails.length} new contacts for runId ${runId}`);

    const contactsLookup = new Map(
      (campaign.contacts || []).map((contact) => [
        String(contact._id || contact.contactId || ''),
        contact
      ])
    );

    const newContacts = newDetails
      .map((detail) => buildHistoryContactFromDetail(detail, contactsLookup))
      .filter(Boolean);

    if (newContacts.length === 0) {
      return history;
    }

    await CampaignHistory.updateOne(
      { _id: history._id },
      {
        $push: { contacts: { $each: newContacts } },
        $set: { updatedAt: new Date() }
      }
    );

    // Recalculate stats after syncing new contacts
    const updatedHistory = await CampaignHistory.findById(history._id).lean();
    if (updatedHistory && Array.isArray(updatedHistory.contacts)) {
      const allContacts = updatedHistory.contacts;
      const totalContacts = allContacts.length;
      const successfulCalls = allContacts.filter(
        (c) => c.leadStatus && c.leadStatus !== 'not_connected'
      ).length;
      const failedCalls = allContacts.filter(
        (c) => !c.leadStatus || c.leadStatus === 'not_connected'
      ).length;
      const totalCallDuration = allContacts.reduce(
        (sum, c) => sum + (Number(c.duration) || Number(c.callDuration) || 0),
        0
      );
      const averageCallDuration =
        totalContacts > 0 ? Math.round(totalCallDuration / totalContacts) : 0;

      await CampaignHistory.updateOne(
        { _id: history._id },
        {
          $set: {
            stats: {
              totalContacts,
              successfulCalls,
              failedCalls,
              totalCallDuration,
              averageCallDuration
            }
          }
        }
      );
    }

    return CampaignHistory.findById(history._id);
  };

  const fetchTranscriptCounts = async (documentIds, runIdFilter, clientId) => {
    if (!Array.isArray(documentIds) || documentIds.length === 0) {
      return new Map();
    }
    const uniqueIds = [...new Set(documentIds.filter(Boolean))];
    if (uniqueIds.length === 0) {
      return new Map();
    }

    const buildPipeline = (matchStage) => [
      { $match: matchStage },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$metadata.customParams.uniqueid',
          transcriptSum: {
            $sum: {
              $add: [
                { $ifNull: ['$metadata.userTranscriptCount', 0] },
                { $ifNull: ['$metadata.aiResponseCount', 0] },
                {
                  $cond: [
                    { $isArray: '$transcript' },
                    { $size: '$transcript' },
                    0
                  ]
                }
              ]
            }
          },
          userTranscriptCount: { $max: { $ifNull: ['$metadata.userTranscriptCount', 0] } },
          aiResponseCount: { $max: { $ifNull: ['$metadata.aiResponseCount', 0] } }
        }
      },
      {
        $project: {
          uniqueId: '$_id',
          transcriptCount: {
            $max: [
              '$transcriptSum',
              { $add: ['$userTranscriptCount', '$aiResponseCount'] }
            ]
          }
        }
      }
    ];

    const baseMatch = {
      'metadata.customParams.uniqueid': { $in: uniqueIds }
    };
    if (runIdFilter) {
      baseMatch['metadata.customParams.runId'] = runIdFilter;
    }
    if (clientId) {
      baseMatch.clientId = clientId;
    }

    let aggregation = await CallLog.aggregate(buildPipeline(baseMatch), {
      allowDiskUse: true
    });

    // Fallback 1: drop runId filter (some legacy logs don't store it)
    if ((!aggregation || aggregation.length === 0) && runIdFilter) {
      const fallbackMatch = { ...baseMatch };
      delete fallbackMatch['metadata.customParams.runId'];
      aggregation = await CallLog.aggregate(buildPipeline(fallbackMatch), {
        allowDiskUse: true
      });
    }

    // Fallback 2: drop clientId filter if still empty (cross-tenant logs)
    if ((!aggregation || aggregation.length === 0) && baseMatch.clientId) {
      const fallbackMatch = { ...baseMatch };
      delete fallbackMatch.clientId;
      aggregation = await CallLog.aggregate(buildPipeline(fallbackMatch), {
        allowDiskUse: true
      });
    }

    const map = new Map();
    for (const entry of aggregation || []) {
      const key = entry.uniqueId || entry._id;
      if (!key) continue;
      const value =
        typeof entry.transcriptCount === 'number' ? entry.transcriptCount : 0;
      map.set(String(key), value);
    }
    return map;
  };

  try {
    const { id: campaignId, runId } = req.params;
    const { contactIds, humanAgentIds, transcriptRange } = req.body || {};

    if (!runId) {
      return res.status(400).json({
        success: false,
        error: 'runId parameter is required'
      });
    }

    const normalizedContactIds = Array.isArray(contactIds)
      ? [...new Set(contactIds.map((id) => String(id)))]
      : [];
    const hasContactIds = normalizedContactIds.length > 0;

    const hasTranscriptRange =
      transcriptRange &&
      (transcriptRange.minTranscriptCount !== undefined ||
        transcriptRange.maxTranscriptCount !== undefined);

    if (!hasContactIds && !hasTranscriptRange) {
      return res.status(400).json({
        success: false,
        error: 'Provide contactIds array or a transcriptRange object'
      });
    }

    if (
      !humanAgentIds ||
      !Array.isArray(humanAgentIds) ||
      humanAgentIds.length === 0
    ) {
      return res.status(400).json({
        success: false,
        error: 'humanAgentIds array is required and must not be empty'
      });
    }

    let minTranscriptCount = null;
    let maxTranscriptCount = null;
    if (hasTranscriptRange) {
      minTranscriptCount = parseNumericValue(
        transcriptRange.minTranscriptCount,
        false
      );
      maxTranscriptCount = parseNumericValue(transcriptRange.maxTranscriptCount);

      if (minTranscriptCount === null && transcriptRange.minTranscriptCount) {
        return res.status(400).json({
          success: false,
          error: 'minTranscriptCount must be a valid number'
        });
      }
      if (
        maxTranscriptCount === null &&
        transcriptRange.maxTranscriptCount !== undefined &&
        transcriptRange.maxTranscriptCount !== null &&
        transcriptRange.maxTranscriptCount !== ''
      ) {
        return res.status(400).json({
          success: false,
          error: 'maxTranscriptCount must be a valid number'
        });
      }
      if (
        minTranscriptCount !== null &&
        maxTranscriptCount !== null &&
        minTranscriptCount > maxTranscriptCount
      ) {
        return res.status(400).json({
          success: false,
          error: 'minTranscriptCount cannot exceed maxTranscriptCount'
        });
      }
    }

    const sanitizedHumanAgentIds = [
      ...new Set(humanAgentIds.map((id) => String(id)))
    ];

    // Validate campaign ownership
    const campaign = await Campaign.findOne({
      _id: campaignId,
      clientId: req.clientId
    }).lean();
    if (!campaign) {
      return res.status(404).json({
        success: false,
        error: 'Campaign not found'
      });
    }

    // Validate / bootstrap campaign history document
    let campaignHistory = await CampaignHistory.findOne({
      campaignId: campaign._id,
      runId
    });
    console.log(`[${timestamp}] 📋 ASSIGN: Campaign history lookup - found: ${!!campaignHistory}, runId: ${runId}`);
    
    if (!campaignHistory) {
      console.log(`[${timestamp}] 📋 ASSIGN: Creating history document for runId ${runId}`);
      campaignHistory = await ensureHistoryDocument(campaign, runId);
    }
    if (!campaignHistory) {
      console.log(`[${timestamp}] ❌ ASSIGN: Failed to create/find history document for runId ${runId}`);
      return res.status(404).json({
        success: false,
        error:
          'Campaign history not found for this run. Wait for calls to be logged and try again.'
      });
    }

    console.log(`[${timestamp}] 📋 ASSIGN: Syncing contacts from campaign.details to history for runId ${runId}`);
    campaignHistory = await syncHistoryContactsFromDetails(
      campaignHistory,
      campaign,
      runId
    );
    
    if (!campaignHistory) {
      console.log(`[${timestamp}] ❌ ASSIGN: Failed to sync contacts for runId ${runId}`);
      return res.status(500).json({
        success: false,
        error: 'Failed to sync campaign history contacts'
      });
    }
    
    console.log(`[${timestamp}] ✅ ASSIGN: History document ready with ${campaignHistory.contacts?.length || 0} contacts`);

    const historyContacts = Array.isArray(campaignHistory?.contacts)
      ? campaignHistory.contacts.map((contact) =>
          contact?.toObject ? contact.toObject() : contact
        )
      : [];
    
    console.log(`[${timestamp}] 📋 ASSIGN: History has ${historyContacts.length} contacts after sync`);

    const contactIdMap = new Map(
      historyContacts
        .filter((contact) => contact && contact._id)
        .map((contact) => [String(contact._id), contact])
    );
    const documentIdMap = new Map(
      historyContacts
        .filter((contact) => contact?.documentId)
        .map((contact) => [String(contact.documentId), contact])
    );

    if (!hasContactIds && historyContacts.length === 0) {
      return res.status(400).json({
        success: false,
        error:
          'No contacts available for this run yet. Please try again once calls are logged.'
      });
    }

    // Validate human agents
    const humanAgents = await HumanAgent.find({
      _id: { $in: sanitizedHumanAgentIds },
      clientId: req.clientId,
      isApproved: true
    });
    if (humanAgents.length !== sanitizedHumanAgentIds.length) {
      return res.status(400).json({
        success: false,
        error: 'Some human agents not found or not approved'
      });
    }

    let transcriptCountsMap = null;
    if (hasTranscriptRange) {
      const documentIds = Array.from(documentIdMap.keys());
      console.log(`[${timestamp}] 📊 TRANSCRIPT: Fetching fresh transcript counts for ${documentIds.length} documentIds (live campaign check)`);
      // Always fetch fresh transcript counts for live campaigns to get real-time updates
      transcriptCountsMap = await fetchTranscriptCounts(
        documentIds,
        runId,
        req.clientId
      );
      console.log(`[${timestamp}] 📊 TRANSCRIPT: Found transcript counts for ${transcriptCountsMap.size} contacts`);
      
      // Log transcript counts for debugging
      if (transcriptCountsMap.size > 0) {
        const sampleCounts = Array.from(transcriptCountsMap.entries()).slice(0, 5);
        console.log(`[${timestamp}] 📊 TRANSCRIPT SAMPLE: First 5 counts:`, sampleCounts.map(([id, count]) => ({ id: id.slice(0, 8) + '...', count })));
      }

      // Persist updated transcript counts to history for future quick lookups
      if (transcriptCountsMap.size > 0) {
        const bulkUpdates = [];
        for (const [docId, count] of transcriptCountsMap.entries()) {
          const targetContact = documentIdMap.get(docId);
          if (!targetContact) continue;
          if (targetContact.transcriptCount === count) continue;
          targetContact.transcriptCount = count;
          bulkUpdates.push({
            updateOne: {
              filter: { _id: campaignHistory._id, 'contacts._id': targetContact._id },
              update: { $set: { 'contacts.$.transcriptCount': count } }
            }
          });
        }
        if (bulkUpdates.length > 0) {
          await CampaignHistory.bulkWrite(bulkUpdates);
        }
      }
    }

    const resolveContactId = (rawId) => {
      const normalized = String(rawId || '').trim();
      if (!normalized) return null;
      if (contactIdMap.has(normalized)) return normalized;
      const docMatch = documentIdMap.get(normalized);
      if (docMatch && docMatch._id) {
        return String(docMatch._id);
      }
      return null;
    };

    let targetContactIds = normalizedContactIds
      .map(resolveContactId)
      .filter(Boolean);
    let appliedTranscriptRange = null;
    if (!targetContactIds.length && hasTranscriptRange) {
      const fallbackMin = minTranscriptCount ?? 0;
      const fallbackMax = maxTranscriptCount;
      appliedTranscriptRange = {
        minTranscriptCount: fallbackMin,
        maxTranscriptCount:
          fallbackMax === null || fallbackMax === undefined ? null : fallbackMax
      };

      console.log(`📊 TRANSCRIPT FILTER: Filtering ${historyContacts.length} contacts with range [${fallbackMin}, ${fallbackMax === null ? 'null' : fallbackMax}]`);
      
      targetContactIds = historyContacts
        .filter((contact) => {
          // Skip contacts that are already assigned to any of the target human agents
          const existingAssignments = new Set(
            (contact.assignedToHumanAgents || []).map((entry) =>
              String(entry.humanAgentId)
            )
          );
          const isAlreadyAssigned = sanitizedHumanAgentIds.some(
            (agentId) => existingAssignments.has(String(agentId))
          );
          
          if (isAlreadyAssigned) {
            return false; // Skip already assigned contacts
          }
          
          // Get current transcript count (fetch fresh from CallLogs)
          const transcriptCount =
            (contact.documentId &&
              transcriptCountsMap?.get(String(contact.documentId))) ??
            (typeof contact.transcriptCount === 'number'
              ? contact.transcriptCount
              : 0);
          
          const matchesMin = transcriptCount >= fallbackMin;
          const matchesMax = fallbackMax === null || fallbackMax === undefined || transcriptCount <= fallbackMax;
          const matches = matchesMin && matchesMax;
          
          if (!matches) {
            console.log(`⏳ TRANSCRIPT FILTER: Contact ${contact.documentId || contact._id} not yet in range - transcriptCount: ${transcriptCount}, range: [${fallbackMin}, ${fallbackMax === null ? 'null' : fallbackMax}]`);
          } else {
            console.log(`✅ TRANSCRIPT FILTER: Contact ${contact.documentId || contact._id} matches range - transcriptCount: ${transcriptCount}, range: [${fallbackMin}, ${fallbackMax === null ? 'null' : fallbackMax}]`);
          }
          
          return matches;
        })
        .map((contact) => String(contact._id))
        .filter(Boolean);
      
      console.log(`✅ TRANSCRIPT FILTER: ${targetContactIds.length} contacts matched the transcript range and are not already assigned`);
    }

    console.log(`📊 ASSIGNMENT: Found ${targetContactIds.length} contacts to assign out of ${historyContacts.length} total contacts`);
    console.log(`📊 ASSIGNMENT: hasTranscriptRange: ${hasTranscriptRange}, hasContactIds: ${hasContactIds}, historyContacts.length: ${historyContacts.length}`);
    
    if (!targetContactIds.length) {
      const reason = hasTranscriptRange 
        ? `No unassigned contacts matched transcript range [${minTranscriptCount ?? 0}, ${maxTranscriptCount === null ? 'null' : maxTranscriptCount}]. Will continue checking for live calls.`
        : 'No contacts provided or found';
      console.log(`[${timestamp}] ⚠️ ASSIGNMENT: ${reason}`);
      
      // For live campaigns, return success even if no contacts match yet (they might match later)
      return res.json({
        success: true,
        message: reason,
        data: {
          assignedContactsCount: 0,
          assignedHumanAgentsCount: sanitizedHumanAgentIds.length,
          humanAgents: humanAgents.map((agent) => ({
            _id: agent._id,
            humanAgentName: agent.humanAgentName,
            email: agent.email,
            role: agent.role
          })),
          assignedContacts: [],
          transcriptRangeApplied: appliedTranscriptRange,
          debug: {
            totalHistoryContacts: historyContacts.length,
            transcriptRange: hasTranscriptRange ? { min: minTranscriptCount, max: maxTranscriptCount } : null,
            hasContactIds,
            alreadyAssignedCount: historyContacts.filter(c => {
              const existingAssignments = new Set(
                (c.assignedToHumanAgents || []).map((entry) => String(entry.humanAgentId))
              );
              return sanitizedHumanAgentIds.some((agentId) => existingAssignments.has(String(agentId)));
            }).length
          }
        }
      });
    }

    const invalidContactIds = normalizedContactIds.filter(
      (rawId) => !resolveContactId(rawId)
    );
    if (
      invalidContactIds.length > 0 &&
      invalidContactIds.length === normalizedContactIds.length &&
      !hasTranscriptRange
    ) {
      return res.status(400).json({
        success: false,
        error: `Some contacts not found in campaign history: ${invalidContactIds.join(
          ', '
        )}`
      });
    }

    const now = new Date();
    const assignmentOps = [];
    for (const contactId of targetContactIds) {
      const contact = contactIdMap.get(contactId);
      if (!contact) continue;
      const existingAssignments = new Set(
        (contact.assignedToHumanAgents || []).map((entry) =>
          String(entry.humanAgentId)
        )
      );

      const newAssignments = sanitizedHumanAgentIds
        .filter((agentId) => !existingAssignments.has(String(agentId)))
        .map((agentId) => ({
          humanAgentId: agentId,
          assignedAt: now,
          assignedBy: req.clientId
        }));

      if (newAssignments.length === 0) continue;

      assignmentOps.push({
        updateOne: {
          filter: {
            _id: campaignHistory._id,
            'contacts._id': contact._id
          },
          update: {
            $push: {
              'contacts.$.assignedToHumanAgents': { $each: newAssignments }
            }
          }
        }
      });
    }

    if (assignmentOps.length === 0) {
      return res.json({
        success: true,
        message:
          'Selected contacts are already assigned to the chosen human agents',
        data: {
          assignedContactsCount: 0,
          assignedHumanAgentsCount: sanitizedHumanAgentIds.length,
          humanAgents: humanAgents.map((agent) => ({
            _id: agent._id,
            humanAgentName: agent.humanAgentName,
            email: agent.email,
            role: agent.role
          })),
          assignedContacts: [],
          transcriptRangeApplied: appliedTranscriptRange
        }
      });
    }

    console.log(`[${timestamp}] 📋 ASSIGNMENT: Executing ${assignmentOps.length} assignment operations`);
    await CampaignHistory.bulkWrite(assignmentOps);
    console.log(`[${timestamp}] ✅ ASSIGNMENT: Successfully assigned ${assignmentOps.length} contacts`);

    const updatedHistory = await CampaignHistory.findOne({
      campaignId: campaign._id,
      runId
    })
      .populate(
        'contacts.assignedToHumanAgents.humanAgentId',
        'humanAgentName email role'
      )
      .lean();

    const assignedContacts = (updatedHistory.contacts || []).filter((contact) =>
      targetContactIds.includes(String(contact._id))
    );

    res.json({
      success: true,
      message: `Successfully assigned ${assignedContacts.length} contact(s) to ${sanitizedHumanAgentIds.length} human agent(s)`,
      data: {
        assignedContactsCount: assignedContacts.length,
        assignedHumanAgentsCount: sanitizedHumanAgentIds.length,
        humanAgents: humanAgents.map((agent) => ({
          _id: agent._id,
          humanAgentName: agent.humanAgentName,
          email: agent.email,
          role: agent.role
        })),
        assignedContacts: assignedContacts.map((contact) => {
          const effectiveTranscriptCount =
            (contact.documentId &&
              transcriptCountsMap?.get(String(contact.documentId))) ??
            contact.transcriptCount ??
            0;
          return {
            _id: contact._id,
            documentId: contact.documentId,
            number: contact.number,
            name: contact.name,
            leadStatus: contact.leadStatus,
            status: contact.status,
            transcriptCount: effectiveTranscriptCount,
            assignedToHumanAgents: contact.assignedToHumanAgents || []
          };
        }),
        transcriptRangeApplied: appliedTranscriptRange
      }
    });
  } catch (error) {
    console.error(
      'Error assigning campaign history contacts to human agents:',
      error
    );
    res.status(500).json({
      success: false,
      error: 'Internal server error while assigning contacts'
    });
  }
};

module.exports = { 
  getUploadUrl,
  switchProfile,
  getUploadUrlMyBusiness,
  getUploadUrlCustomization,
  getUploadUrlKnowledgeBase,
  getFileUrlByKey,
  createKnowledgeItem,
  getKnowledgeItems,
  updateKnowledgeItem,
  deleteKnowledgeItem,
  embedKnowledgeItem,
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
  loginHumanAgentGoogle,
  assignCampaignHistoryContactsToHumanAgents
};
