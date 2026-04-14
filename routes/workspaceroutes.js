const express = require('express');
const router = express.Router();
const { 
    createWorkspace, 
    getWorkspaces, 
    updateWorkspace, 
    deleteWorkspace, 
    getWorkspaceClients,
    assignClient 
} = require('../controllers/workspaceController');
const { verifyAdminToken } = require('../middlewares/authmiddleware');

router.post('/', verifyAdminToken, createWorkspace);
router.get('/', verifyAdminToken, getWorkspaces);
router.put('/:id', verifyAdminToken, updateWorkspace);
router.delete('/:id', verifyAdminToken, deleteWorkspace);
router.get('/:id/clients', verifyAdminToken, getWorkspaceClients);
router.post('/assign', verifyAdminToken, assignClient);

module.exports = router;
