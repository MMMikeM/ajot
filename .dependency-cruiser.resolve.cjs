// dependency-cruiser reads tsconfig paths through the typescript package, which only supports
// TypeScript < 7, so the client's ~ alias is declared here instead.
module.exports = {
  resolve: {
    alias: { "~": `${__dirname}/packages/client/src` },
  },
};
