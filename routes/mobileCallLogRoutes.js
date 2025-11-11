const express = require('express');
const router = express.Router();

const { verifyClientOrAdminAndExtractClientId } = require('../middlewares/authmiddleware');
const mongoose = require('mongoose');
const MobileUser = require('../models/MobileUser');
const MobileContact = require('../models/MobileContact');
const { MobileCallLog, callStatuses, callDirections } = require('../models/MobileCallLog');

/**
 * Helper: parse date range from query
 */
function getDateRange(query) {
  const now = new Date();
  let start, end;

  if (query.range === 'today') {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  } else if (query.range === 'yesterday') {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (query.range === 'last7') {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
    end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  } else if (query.start || query.end) {
    start = query.start ? new Date(query.start) : new Date(0);
    end = query.end ? new Date(query.end) : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  }

  return start && end ? { startedAt: { $gte: start, $lt: end } } : {};
}

/**
 * POST /call-logs/upload
 * Body: { mobileUser: { deviceId, name, phoneNumber, email }, contacts?: [..], callLogs?: [..] }
 * Upserts MobileUser, upserts contacts, inserts/updates call logs (by externalId if provided)
 */
router.post('/call-logs/upload', verifyClientOrAdminAndExtractClientId, async (req, res) => {
  try {
    const clientId = req.clientId;
    if (!clientId) return res.status(400).json({ success: false, message: 'clientId required (or use client token)' });

    const { mobileUser, contacts = [], callLogs = [] } = req.body || {};
    if (!mobileUser || !mobileUser.deviceId) {
      return res.status(400).json({ success: false, message: 'mobileUser.deviceId is required' });
    }

    // Upsert MobileUser
    const mobileUserDoc = await MobileUser.findOneAndUpdate(
      { clientId, deviceId: mobileUser.deviceId },
      { $set: { ...mobileUser, clientId, lastSyncAt: new Date() } },
      { new: true, upsert: true }
    );

    // Upsert Contacts
    let contactsUpserted = 0;
    if (Array.isArray(contacts) && contacts.length) {
      const ops = contacts.map(c => ({
        updateOne: {
          filter: { clientId, mobileUserId: mobileUserDoc._id, phoneNumber: String(c.phoneNumber) },
          update: {
            $set: {
              clientId,
              mobileUserId: mobileUserDoc._id,
              phoneNumber: String(c.phoneNumber),
              name: c.name || '',
              email: c.email || '',
              tags: c.tags || [],
              source: c.source || 'mobile_share',
              lastSharedAt: new Date(),
              metadata: c.metadata || {}
            }
          },
          upsert: true
        }
      }));
      const result = await MobileContact.bulkWrite(ops, { ordered: false });
      contactsUpserted = (result.upsertedCount || 0) + (result.modifiedCount || 0);
    }

    // Upsert Call Logs
    let callLogsUpserted = 0;
    if (Array.isArray(callLogs) && callLogs.length) {
      const ops = callLogs.map(cl => {
        const startedAt = cl.startedAt ? new Date(cl.startedAt) : new Date();
        const endedAt = cl.endedAt ? new Date(cl.endedAt) : undefined;
        return {
          updateOne: {
            filter: { clientId, mobileUserId: mobileUserDoc._id, externalId: cl.externalId || undefined, startedAt },
            update: {
              $setOnInsert: { clientId, mobileUserId: mobileUserDoc._id },
              $set: {
                phoneNumber: String(cl.phoneNumber),
                contactName: cl.contactName || '',
                direction: cl.direction && callDirections.includes(cl.direction) ? cl.direction : 'outgoing',
                status: cl.status && callStatuses.includes(cl.status) ? cl.status : 'connected',
                startedAt,
                endedAt,
                durationSeconds: cl.durationSeconds || (endedAt ? Math.max(0, Math.round((endedAt - startedAt) / 1000)) : 0),
                callResult: cl.callResult || '',
                externalId: cl.externalId || undefined,
                notes: cl.notes || '',
                metadata: cl.metadata || {}
              }
            },
            upsert: true
          }
        };
      });
      const result = await MobileCallLog.bulkWrite(ops, { ordered: false });
      callLogsUpserted = (result.upsertedCount || 0) + (result.modifiedCount || 0);
    }

    res.json({
      success: true,
      data: {
        mobileUserId: mobileUserDoc._id,
        contactsUpserted,
        callLogsUpserted
      }
    });
  } catch (error) {
    console.error('upload call logs error', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /call-logs/summary
 * Query: range=today|yesterday|last7 or start,end; direction?, phone?, status?
 * Returns totals for grids
 */
router.get('/call-logs/summary', verifyClientOrAdminAndExtractClientId, async (req, res) => {
  try {
    const clientId = req.clientId ? new mongoose.Types.ObjectId(req.clientId) : undefined;
    const filter = { ...getDateRange(req.query) };
    if (clientId) filter.clientId = clientId;
    if (req.query.direction && callDirections.includes(req.query.direction)) filter.direction = req.query.direction;
    if (req.query.status && callStatuses.includes(req.query.status)) filter.status = req.query.status;
    if (req.query.phone) filter.phoneNumber = String(req.query.phone);

    const baseMatch = [{ $match: filter }];

    const [totalAgg, incomingAgg, outgoingAgg, missedAgg, rejectedAgg, notPickedAgg, neverAttendedAgg] = await Promise.all([
      MobileCallLog.aggregate([...baseMatch, { $group: { _id: null, count: { $sum: 1 }, duration: { $sum: '$durationSeconds' } } }]),
      MobileCallLog.aggregate([...baseMatch, { $match: { direction: 'incoming' } }, { $group: { _id: null, count: { $sum: 1 }, duration: { $sum: '$durationSeconds' } } }]),
      MobileCallLog.aggregate([...baseMatch, { $match: { direction: 'outgoing' } }, { $group: { _id: null, count: { $sum: 1 }, duration: { $sum: '$durationSeconds' } } }]),
      MobileCallLog.aggregate([...baseMatch, { $match: { status: 'missed' } }, { $group: { _id: null, count: { $sum: 1 } } }]),
      MobileCallLog.aggregate([...baseMatch, { $match: { status: 'rejected' } }, { $group: { _id: null, count: { $sum: 1 } } }]),
      MobileCallLog.aggregate([...baseMatch, { $match: { status: 'not_picked_by_client' } }, { $group: { _id: null, count: { $sum: 1 } } }]),
      MobileCallLog.aggregate([...baseMatch, { $match: { status: 'never_attended' } }, { $group: { _id: null, count: { $sum: 1 } } }])
    ]);

    res.json({
      success: true,
      data: {
        total: { count: totalAgg[0]?.count || 0, durationSeconds: totalAgg[0]?.duration || 0 },
        incoming: { count: incomingAgg[0]?.count || 0, durationSeconds: incomingAgg[0]?.duration || 0 },
        outgoing: { count: outgoingAgg[0]?.count || 0, durationSeconds: outgoingAgg[0]?.duration || 0 },
        missed: { count: missedAgg[0]?.count || 0 },
        rejected: { count: rejectedAgg[0]?.count || 0 },
        notPickedByClient: { count: notPickedAgg[0]?.count || 0 },
        neverAttended: { count: neverAttendedAgg[0]?.count || 0 }
      }
    });
  } catch (error) {
    console.error('summary error', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /call-logs/analysis
 * Query: type=top_caller|longest_call|highest_total_duration|average_duration|top10_frequent|top10_duration
 */
router.get('/call-logs/analysis', verifyClientOrAdminAndExtractClientId, async (req, res) => {
  try {
    const clientId = req.clientId ? new mongoose.Types.ObjectId(req.clientId) : undefined;
    const match = { ...getDateRange(req.query) };
    if (clientId) match.clientId = clientId;
    const type = req.query.type || 'top_caller';

    if (type === 'longest_call') {
      const result = await MobileCallLog.find(match).sort({ durationSeconds: -1 }).limit(1).lean();
      return res.json({ success: true, data: result });
    }

    if (type === 'highest_total_duration') {
      const [overall] = await MobileCallLog.aggregate([
        { $match: match },
        { $group: { _id: '$phoneNumber', totalDuration: { $sum: '$durationSeconds' }, count: { $sum: 1 } } },
        { $sort: { totalDuration: -1 } },
        { $limit: 1 }
      ]);
      if (!overall) return res.json({ success: true, data: [] });

      const [byDir] = await MobileCallLog.aggregate([
        { $match: { ...match, phoneNumber: overall._id } },
        { $group: {
          _id: '$phoneNumber',
          incomingDuration: { $sum: { $cond: [{ $eq: ['$direction', 'incoming'] }, '$durationSeconds', 0] } },
          outgoingDuration: { $sum: { $cond: [{ $eq: ['$direction', 'outgoing'] }, '$durationSeconds', 0] } },
          incomingCount: { $sum: { $cond: [{ $eq: ['$direction', 'incoming'] }, 1, 0] } },
          outgoingCount: { $sum: { $cond: [{ $eq: ['$direction', 'outgoing'] }, 1, 0] } }
        } }
      ]);

      return res.json({
        success: true,
        data: [{
          phoneNumber: overall._id,
          totalDuration: overall.totalDuration,
          count: overall.count,
          incomingDuration: byDir?.incomingDuration || 0,
          outgoingDuration: byDir?.outgoingDuration || 0,
          incomingCount: byDir?.incomingCount || 0,
          outgoingCount: byDir?.outgoingCount || 0
        }]
      });
    }

    if (type === 'average_duration') {
      const perCall = await MobileCallLog.aggregate([
        { $match: match },
        { $group: { _id: null, avgDuration: { $avg: '$durationSeconds' }, count: { $sum: 1 } } }
      ]);
      const perCallByDirection = await MobileCallLog.aggregate([
        { $match: match },
        { $group: { _id: '$direction', avgDuration: { $avg: '$durationSeconds' }, count: { $sum: 1 }, total: { $sum: '$durationSeconds' } } }
      ]);
      // per day
      const perDay = await MobileCallLog.aggregate([
        { $match: match },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$startedAt' } }, duration: { $sum: '$durationSeconds' }, count: { $sum: 1 } } },
        { $project: { _id: 0, day: '$_id', avgDuration: { $cond: [{ $eq: ['$count', 0] }, 0, { $divide: ['$duration', '$count'] }] } } },
        { $sort: { day: 1 } }
      ]);
      return res.json({ 
        success: true, 
        data: { 
          perCall: perCall[0] || { avgDuration: 0, count: 0 }, 
          perCallByDirection,
          perDay 
        } 
      });
    }

    if (type === 'top10_frequent') {
      const all = await MobileCallLog.aggregate([
        { $match: match },
        { $group: { _id: '$phoneNumber', count: { $sum: 1 }, totalDuration: { $sum: '$durationSeconds' } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]);
      const incoming = await MobileCallLog.aggregate([
        { $match: { ...match, direction: 'incoming' } },
        { $group: { _id: '$phoneNumber', count: { $sum: 1 }, totalDuration: { $sum: '$durationSeconds' } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]);
      const outgoing = await MobileCallLog.aggregate([
        { $match: { ...match, direction: 'outgoing' } },
        { $group: { _id: '$phoneNumber', count: { $sum: 1 }, totalDuration: { $sum: '$durationSeconds' } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]);
      return res.json({ success: true, data: { all, incoming, outgoing } });
    }

    if (type === 'top10_duration') {
      const all = await MobileCallLog.aggregate([
        { $match: match },
        { $group: { _id: '$phoneNumber', totalDuration: { $sum: '$durationSeconds' }, count: { $sum: 1 } } },
        { $sort: { totalDuration: -1 } },
        { $limit: 10 }
      ]);
      const incoming = await MobileCallLog.aggregate([
        { $match: { ...match, direction: 'incoming' } },
        { $group: { _id: '$phoneNumber', totalDuration: { $sum: '$durationSeconds' }, count: { $sum: 1 } } },
        { $sort: { totalDuration: -1 } },
        { $limit: 10 }
      ]);
      const outgoing = await MobileCallLog.aggregate([
        { $match: { ...match, direction: 'outgoing' } },
        { $group: { _id: '$phoneNumber', totalDuration: { $sum: '$durationSeconds' }, count: { $sum: 1 } } },
        { $sort: { totalDuration: -1 } },
        { $limit: 10 }
      ]);
      return res.json({ success: true, data: { all, incoming, outgoing } });
    }

    // default top_caller
    const result = await MobileCallLog.aggregate([
      { $match: match },
      { $group: { _id: '$phoneNumber', count: { $sum: 1 }, totalDuration: { $sum: '$durationSeconds' } } },
      { $sort: { count: -1, totalDuration: -1 } },
      { $limit: 1 }
    ]);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('analysis error', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /call-logs/id/:id  (avoid conflict with /call-logs/filters)
 */
router.get('/call-logs/id/:id', verifyClientOrAdminAndExtractClientId, async (req, res) => {
  const { id } = req.params;
  console.log('id', id);
  const clientId = req.clientId;
  const logContext = {
    callLogId: id,
    clientId,
    userId: req.user?.id,
    userType: req.user?.userType
  };

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      console.warn('[call-logs:id] Invalid call log id', logContext);
      return res.status(400).json({ success: false, message: 'Invalid call log id' });
    }

    if (!clientId) {
      console.warn('[call-logs:id] Missing client context', logContext);
      return res.status(400).json({ success: false, message: 'clientId is required for this request' });
    }

    if (!mongoose.Types.ObjectId.isValid(clientId)) {
      console.warn('[call-logs:id] Invalid client id on request', logContext);
      return res.status(400).json({ success: false, message: 'Invalid client id' });
    }

    console.info('[call-logs:id] Fetching call log', logContext);

    const doc = await MobileCallLog.findOne(
      { _id: id, clientId }
    ).populate('mobileUserId').lean();
    if (!doc) return res.status(404).json({ success: false, message: 'Not found' });

    const contact = await MobileContact.findOne({ clientId: req.clientId, phoneNumber: doc.phoneNumber }).lean();
    res.json({ success: true, data: { ...doc, contact } });
  } catch (error) {
    console.error('[call-logs:id] Error fetching call log', { ...logContext, error });
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /call-logs/filters
 * Returns static filter options and supports server-side filtered listing via query
 * Query: page, limit, direction, status, phone, name, start, end
 */
router.get('/call-logs/filters', verifyClientOrAdminAndExtractClientId, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const match = { clientId: req.clientId, ...getDateRange(req.query) };
    if (req.query.direction && callDirections.includes(req.query.direction)) match.direction = req.query.direction;
    if (req.query.status && callStatuses.includes(req.query.status)) match.status = req.query.status;
    if (req.query.phone) match.phoneNumber = String(req.query.phone);

    // name filter via contacts
    if (req.query.name) {
      const phones = await MobileContact.find({
        clientId: req.clientId,
        name: { $regex: req.query.name, $options: 'i' }
      }).distinct('phoneNumber');
      match.phoneNumber = { $in: phones.length ? phones : ['__none__'] };
    }

    const [items, total] = await Promise.all([
      MobileCallLog.find(match)
        .sort({ startedAt: -1 })
        .skip((Number(page) - 1) * Number(limit))
        .limit(Number(limit))
        .lean(),
      MobileCallLog.countDocuments(match)
    ]);

    res.json({
      success: true,
      data: {
        options: {
          statuses: callStatuses,
          directions: callDirections
        },
        items,
        page: Number(page),
        limit: Number(limit),
        total
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Contacts: upload and list with filters
 */
router.post('/contacts/upload', verifyClientOrAdminAndExtractClientId, async (req, res) => {
  try {
    const { mobileUser } = req.body || {};
    if (!mobileUser || !mobileUser.deviceId) return res.status(400).json({ success: false, message: 'mobileUser.deviceId required' });

    const mobileUserDoc = await MobileUser.findOneAndUpdate(
      { clientId: req.clientId, deviceId: mobileUser.deviceId },
      { $set: { ...mobileUser, clientId: req.clientId, lastSyncAt: new Date() } },
      { new: true, upsert: true }
    );

    const contacts = Array.isArray(req.body.contacts) ? req.body.contacts : [];
    if (!contacts.length) return res.json({ success: true, data: { upserted: 0 } });

    const ops = contacts.map(c => ({
      updateOne: {
        filter: { clientId: req.clientId, mobileUserId: mobileUserDoc._id, phoneNumber: String(c.phoneNumber) },
        update: {
          $set: {
            clientId: req.clientId,
            mobileUserId: mobileUserDoc._id,
            phoneNumber: String(c.phoneNumber),
            name: c.name || '',
            email: c.email || '',
            tags: c.tags || [],
            source: c.source || 'mobile_share',
            lastSharedAt: new Date(),
            metadata: c.metadata || {}
          }
        },
        upsert: true
      }
    }));
    const result = await MobileContact.bulkWrite(ops, { ordered: false });
    const upserted = (result.upsertedCount || 0) + (result.modifiedCount || 0);
    res.json({ success: true, data: { upserted } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/contacts', verifyClientOrAdminAndExtractClientId, async (req, res) => {
  try {
    const { page = 1, limit = 20, q, tag, start, end } = req.query;
    const match = { clientId: req.clientId };
    if (q) {
      match.$or = [
        { name: { $regex: q, $options: 'i' } },
        { phoneNumber: { $regex: q, $options: 'i' } }
      ];
    }
    if (tag) match.tags = tag;
    if (start || end) {
      const range = {};
      if (start) range.$gte = new Date(start);
      if (end) range.$lte = new Date(end);
      match.lastSharedAt = range;
    }

    const [items, total] = await Promise.all([
      MobileContact.find(match).sort({ lastSharedAt: -1 }).skip((Number(page) - 1) * Number(limit)).limit(Number(limit)).lean(),
      MobileContact.countDocuments(match)
    ]);

    res.json({ success: true, data: { items, total, page: Number(page), limit: Number(limit) } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;


