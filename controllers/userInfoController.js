const User = require("../models/User");
const Contact = require("../models/Contacts");
const Group = require("../models/Group");
const Client = require("../models/Client");
const mongoose = require("mongoose");

const parsePaginationParams = (query) => {
  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
  const rawLimit = Number.parseInt(query.limit, 10);
  const limit = Math.max(Math.min(Number.isNaN(rawLimit) ? 20 : rawLimit, 100), 1);
  return { page, limit };
};

const buildSearchFilter = (fields, searchTerm) => {
  if (!searchTerm) return null;
  const regex = new RegExp(searchTerm.trim(), "i");
  return {
    $or: fields.map((field) => ({ [field]: regex })),
  };
};

const addClientNames = async (records) => {
  if (!records || records.length === 0) return records;
  
  const uniqueClientIds = [...new Set(records.map(r => r.clientId).filter(Boolean))];
  const clientMap = new Map();
  
  if (uniqueClientIds.length > 0) {
    const validObjectIds = uniqueClientIds
      .filter(id => mongoose.Types.ObjectId.isValid(id))
      .map(id => {
        try {
          return new mongoose.Types.ObjectId(id);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    
    if (validObjectIds.length > 0) {
      const clients = await Client.find({
        _id: { $in: validObjectIds }
      }).select('_id name businessName').lean();

      for (const client of clients) {
        const clientIdStr = client._id.toString();
        const clientName = client.name || client.businessName || 'Unknown Client';
        clientMap.set(clientIdStr, clientName);
      }
    }
  }

  return records.map(record => ({
    ...record,
    clientName: clientMap.get(record.clientId) || record.clientId || 'Unknown Client'
  }));
};

exports.getAppUsers = async (req, res) => {
  try {
    const { clientId, search } = req.query;
    const { page, limit } = parsePaginationParams(req.query);

    const filters = {};
    if (clientId) {
      filters._id = clientId;
    }

    const searchFilter = buildSearchFilter(["name", "email", "businessName", "mobileNo", "userId"], search);
    if (searchFilter) {
      Object.assign(filters, searchFilter);
    }

    const [total, clients] = await Promise.all([
      Client.countDocuments(filters),
      Client.find(filters)
        .select('-password')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    // Add clientName field (using name or businessName)
    const clientsWithNames = clients.map(client => ({
      ...client,
      clientName: client.name || client.businessName || 'Unknown Client',
      clientId: client._id.toString()
    }));

    res.json({
      success: true,
      data: clientsWithNames,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit) || 1,
        hasMore: page * limit < total,
      },
    });
  } catch (error) {
    console.error("UserInfoController.getAppUsers error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch app users",
      error: error.message,
    });
  }
};

exports.getContacts = async (req, res) => {
  try {
    const { clientId, search } = req.query;
    const { page, limit } = parsePaginationParams(req.query);

    const filters = {};
    if (clientId) {
      filters.clientId = clientId;
    }

    const searchFilter = buildSearchFilter(["name", "phone", "email", "countyCode"], search);
    if (searchFilter) {
      Object.assign(filters, searchFilter);
    }

    const [total, contacts] = await Promise.all([
      Contact.countDocuments(filters),
      Contact.find(filters)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    const contactsWithClientNames = await addClientNames(contacts);

    res.json({
      success: true,
      data: contactsWithClientNames,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit) || 1,
        hasMore: page * limit < total,
      },
    });
  } catch (error) {
    console.error("UserInfoController.getContacts error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch contacts",
      error: error.message,
    });
  }
};

exports.getGroupContacts = async (req, res) => {
  try {
    const { clientId, search } = req.query;
    const { page, limit } = parsePaginationParams(req.query);

    // Build match filter for groups
    const groupMatch = {};
    if (clientId) {
      groupMatch.clientId = clientId;
    }

    // Aggregate to flatten contacts from all groups
    const pipeline = [
      { $match: groupMatch },
      { $unwind: { path: "$contacts", preserveNullAndEmptyArrays: false } },
      {
        $project: {
          _id: { 
            $concat: [
              { $toString: "$_id" }, 
              "-", 
              { $ifNull: [{ $toString: "$contacts._id" }, "$contacts.phone"] }
            ] 
          },
          name: "$contacts.name",
          phone: "$contacts.phone",
          email: "$contacts.email",
          status: "$contacts.status",
          createdAt: "$contacts.createdAt",
          groupId: "$_id",
          groupName: "$name",
          groupCategory: "$category",
          clientId: "$clientId",
        },
      },
    ];

    // Add search filter if provided
    if (search) {
      const searchRegex = new RegExp(search.trim(), "i");
      pipeline.push({
        $match: {
          $or: [
            { name: searchRegex },
            { phone: searchRegex },
            { email: searchRegex },
            { groupName: searchRegex },
          ],
        },
      });
    }

    // Get total count
    const countPipeline = [...pipeline, { $count: "total" }];
    const countResult = await Group.aggregate(countPipeline);
    const total = countResult[0]?.total || 0;

    // Add sorting, skip, and limit
    pipeline.push(
      { $sort: { createdAt: -1 } },
      { $skip: (page - 1) * limit },
      { $limit: limit }
    );

    const contacts = await Group.aggregate(pipeline);
    const contactsWithClientName = await addClientNames(contacts);

    res.json({
      success: true,
      data: contactsWithClientName,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit) || 1,
        hasMore: page * limit < total,
      },
    });
  } catch (error) {
    console.error("UserInfoController.getGroupContacts error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch group contacts",
      error: error.message,
    });
  }
};


