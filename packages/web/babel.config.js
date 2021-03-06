module.exports = {
  'presets': [
    "@babel/preset-env",
    "@babel/react",
    '@babel/typescript'
  ],
  'plugins': [
    '@babel/plugin-proposal-object-rest-spread',
    ["@babel/plugin-proposal-decorators", { "legacy": true }],
    ["@babel/plugin-proposal-class-properties", { "loose": true }],
  ]
};
