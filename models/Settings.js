const mongoose = require("mongoose");

const settingsSchema = new mongoose.Schema({
  welcomeScreen: {
    type: Boolean,
    default: true,
  },
  contactUsButton: {
    type: Boolean,
    default: true,
  },
});

const Settings = mongoose.model("Settings", settingsSchema);

module.exports = Settings;

