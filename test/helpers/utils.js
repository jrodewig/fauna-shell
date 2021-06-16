const url = require('url')
const env = process.env

module.exports.withOpts = (cmd) => {
  const opts = [
    '--secret',
    env.FAUNA_SECRET,
    '--domain',
    env.FAUNA_DOMAIN,
    '--scheme',
    env.FAUNA_SCHEME,
    '--port',
    env.FAUNA_PORT,
  ]
  return cmd.concat(opts)
}

module.exports.getEndpoint = () =>
  url.format({
    protocol: env.FAUNA_SCHEME,
    hostname: env.FAUNA_DOMAIN,
    port: env.FAUNA_PORT,
  })
