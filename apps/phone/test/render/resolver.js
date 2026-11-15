const path = require("node:path");

const phoneRoot = path.resolve(__dirname, "../..");
const insidePhone = (dir) => dir === phoneRoot || dir.startsWith(phoneRoot + path.sep);
const isBare = (request) => !request.startsWith(".") && !path.isAbsolute(request);

module.exports = (request, options) => options.defaultResolver(request, isBare(request) && !insidePhone(options.basedir) ? { ...options, basedir: phoneRoot } : options);
