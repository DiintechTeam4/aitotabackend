const Workspace = require('../models/Workspace');
const Client = require('../models/Client');
const bcrypt = require('bcryptjs');

// Create a new workspace
exports.createWorkspace = async (req, res) => {
    try {
        const { 
            name, email, password, businessName, websiteUrl, 
            city, pincode, gstNo, panNo, mobileNo, address 
        } = req.body;
        const adminId = req.adminId;

        // Hash password if provided
        let hashedPassword = null;
        if (password) {
            const salt = await bcrypt.genSalt(10);
            hashedPassword = await bcrypt.hash(password, salt);
        }

        // Generate unique appId
        const appId = 'APP-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();

        const workspace = await Workspace.create({
            name,
            email,
            password: hashedPassword,
            appId,
            businessName,
            websiteUrl,
            city,
            pincode,
            gstNo,
            panNo,
            mobileNo,
            address,
            adminId
        });

        res.status(201).json({
            success: true,
            message: 'Workspace created successfully',
            workspace
        });
    } catch (error) {
        console.error('Create workspace error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// Get all workspaces for an admin
exports.getWorkspaces = async (req, res) => {
    try {
        const adminId = req.adminId;
        const workspaces = await Workspace.find({ adminId }).sort({ createdAt: -1 });
        res.status(200).json({
            success: true,
            workspaces
        });
    } catch (error) {
        console.error('Get workspaces error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// Update a workspace
exports.updateWorkspace = async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = { ...req.body };
        
        // Remove password from updateData unless it's being changed
        if (!updateData.password) {
            delete updateData.password;
        } else {
            const salt = await bcrypt.genSalt(10);
            updateData.password = await bcrypt.hash(updateData.password, salt);
        }

        const workspace = await Workspace.findByIdAndUpdate(id, updateData, { new: true });
        
        if (!workspace) {
            return res.status(404).json({ message: 'Workspace not found' });
        }

        res.status(200).json({
            success: true,
            message: 'Workspace updated successfully',
            workspace
        });
    } catch (error) {
        console.error('Update workspace error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// Delete a workspace
exports.deleteWorkspace = async (req, res) => {
    try {
        const { id } = req.params;
        const workspace = await Workspace.findByIdAndDelete(id);

        if (!workspace) {
            return res.status(404).json({ message: 'Workspace not found' });
        }

        // Optional: Remove workspaceId from clients
        await Client.updateMany({ workspaceId: id }, { workspaceId: null });

        res.status(200).json({
            success: true,
            message: 'Workspace deleted successfully'
        });
    } catch (error) {
        console.error('Delete workspace error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// Get clients in a workspace
exports.getWorkspaceClients = async (req, res) => {
    try {
        const { id } = req.params;
        const workspace = await Workspace.findById(id).select('name businessName appId');
        if (!workspace) {
            return res.status(404).json({ success: false, message: 'Workspace not found' });
        }

        // Primary source of truth: explicit assignments
        let clients = await Client.find({ workspaceId: id }).select('-password -waAccessToken');

        // Fallback: Some legacy/external-import clients may not have workspaceId,
        // but they do have `appSource`. We map common workspace names to appSource.
        if (!clients || clients.length === 0) {
            const wName = String(workspace.name || '').trim().toLowerCase();
            const bName = String(workspace.businessName || '').trim().toLowerCase();
            const key = wName || bName;

            const map = {
                hellopaai: 'hellopaai',
                aivani: 'aivani',
                dialai: 'dialai',
                aitota: 'direct'
            };

            const derivedSource = map[key] || map[wName.replace(/\s+/g, '')] || map[bName.replace(/\s+/g, '')] || null;

            if (derivedSource) {
                clients = await Client.find({ appSource: derivedSource }).select('-password -waAccessToken');
            }
        }

        // Final fallback: show same pool as Client Management so workspace "Users"
        // tab never appears empty in legacy setups where workspace mapping was never done.
        if (!clients || clients.length === 0) {
            clients = await Client.find({}).select('-password -waAccessToken').sort({ createdAt: -1 });
        }

        // De-dupe defensively (if in future we combine sources)
        const uniq = new Map();
        for (const c of clients || []) {
            uniq.set(String(c._id), c);
        }
        clients = Array.from(uniq.values());
        res.status(200).json({
            success: true,
            data: clients,
            count: clients.length
        });
    } catch (error) {
        console.error('Get workspace clients error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// Get token for workspace login (opens client dashboard)
exports.getWorkspaceToken = async (req, res) => {
    try {
        const { id } = req.params;
        const jwt = require('jsonwebtoken');

        const workspace = await Workspace.findById(id);
        if (!workspace) {
            return res.status(404).json({ success: false, message: 'Workspace not found' });
        }

        const token = jwt.sign(
            {
                id: workspace._id,
                email: workspace.email,
                userType: 'client',
                isWorkspace: true,
                adminAccess: true
            },
            process.env.JWT_SECRET,
            { expiresIn: '1d' }
        );

        res.json({ success: true, token });
    } catch (error) {
        console.error('getWorkspaceToken error:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// Assign client to workspace
exports.assignClient = async (req, res) => {
    try {
        const { workspaceId, clientId } = req.body;
        const client = await Client.findByIdAndUpdate(clientId, { workspaceId }, { new: true });
        
        if (!client) {
            return res.status(404).json({ message: 'Client not found' });
        }

        res.status(200).json({
            success: true,
            message: 'Client assigned to workspace successfully',
            client
        });
    } catch (error) {
        console.error('Assign client error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
