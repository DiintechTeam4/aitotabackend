const User = require("../models/User");
const Contact = require("../models/Contacts");

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

exports.getAppUsers = async (req, res) => {
  try {
    const { clientId, search } = req.query;
    const { page, limit } = parsePaginationParams(req.query);

    const filters = {};
    if (clientId) {
      filters.clientId = clientId;
    }

    const searchFilter = buildSearchFilter(["name", "email", "mobileNumber", "sessionId"], search);
    if (searchFilter) {
      Object.assign(filters, searchFilter);
    }

    const [total, users] = await Promise.all([
      User.countDocuments(filters),
      User.find(filters)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    res.json({
      success: true,
      data: users,
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

    res.json({
      success: true,
      data: contacts,
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


