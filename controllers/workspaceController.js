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

        const workspace = await Workspace.create({
            name,
            email,
            password: hashedPassword,
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
        const clients = await Client.find({ workspaceId: id }).select('-password');
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
