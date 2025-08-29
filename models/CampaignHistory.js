const mongoose = require('mongoose');

const CampaignHistorySchema = new mongoose.Schema({
    campaignId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Campaign',
        required: true
    },
    contacts:{
        
    }
});

module.exports = mongoose.model('CampaignHistory', CampaignHistorySchema);