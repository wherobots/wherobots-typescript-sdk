module.exports = {
  "**/*.(ts|js|cjs)": () => ["npm run lint:fix", "npm run build:check"],
};
