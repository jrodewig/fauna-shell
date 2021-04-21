const FaunaCommand = require('../lib/fauna-command.js')
const { errorOut, runQueries } = require('../lib/misc.js')
const faunadb = require('faunadb')
const q = faunadb.query
const repl = require('repl')
const util = require('util')
const esprima = require('esprima')

function stringifyEndpoint(endpoint) {
  var res = ''
  if (endpoint.scheme) {
    res += endpoint.scheme + '://'
  }
  res += endpoint.domain
  if (endpoint.port) {
    res += ':' + endpoint.port
  }
  return res
}

class ShellCommand extends FaunaCommand {
  commands = [
    {
      cmd: 'clear',
      help: 'Clear the repl',
      action: this.clear,
    },
    {
      cmd: 'last_error',
      help: 'Display the last error',
      action: this.lastError,
    },
  ]

  async run() {
    const { dbname } = this.args
    this.rootConnection = await this.getClient()

    this.scopeConnection = this.rootConnection
    if (dbname) {
      this.scopeConnection = await this.ensureDbScopeClient()
    }

    this.startShell()
  }

  async ensureDbScopeClient() {
    const { client } = this.rootConnection
    const exists = await client.query(q.Exists(q.Database(this.args.dbname)))
    if (!exists) {
      errorOut(`Database '${this.args.dbname}' doesn't exist`, 1)
    }

    return this.getClient({
      dbScope: this.args.dbname,
      role: 'admin',
    })
  }

  startShell() {
    const { dbname } = this.args
    if (dbname) {
      this.log(`Starting shell for database ${dbname}`)
    }

    this.log(
      `Connected to ${stringifyEndpoint(
        this.scopeConnection.connectionOptions
      )}`
    )
    this.log('Type Ctrl+D or .exit to exit the shell')

    this.repl = repl.start({
      prompt: `${dbname || ''}> `,
      ignoreUndefined: true,
    })
    this.repl.eval = this.withFaunaEval(this.repl.eval)
    this.repl.context.lastError = undefined
    Object.assign(this.repl.context, q)

    // we don't want to allow people to call some of the default commands
    // from the node repl
    this.repl.commands = this.filterCommands(this.repl.commands, [
      'load',
      'editor',
      'clear',
    ])

    this.commands.forEach(({ cmd, ...cmdOptions }) =>
      this.repl.defineCommand(cmd, cmdOptions)
    )
  }
  filterCommands(commands, unwanted) {
    const keys = Object.keys(commands)
    var filteredCommands = {}
    keys
      .filter(function (k) {
        return !unwanted.includes(k)
      })
      .forEach(function (k) {
        filteredCommands[k] = commands[k]
      })
    return filteredCommands
  }

  withFaunaEval(originalEval) {
    return (cmd, ctx, filename, cb) => {
      if (cmd.trim() === '') return cb()

      originalEval(cmd, ctx, filename, async (_err, result) => {
        try {
          if (_err) throw _err
          const res = esprima.parseScript(cmd)
          await this.executeFql({ ctx, fql: res.body }).then(cb)
        } catch (error) {
          if (error.name === 'SyntaxError') {
            cb(new repl.Recoverable(error))
          } else {
            cb(error, result)
          }
        }
      })
    }
  }

  async executeFql({ ctx, fql }) {
    return runQueries(fql, this.scopeConnection.client)
      .then((res) => {
        // we could provide the response result as a second
        // argument to cb(), but the repl util.inspect has a
        // default depth of 2, but we want to display the full
        // objects or arrays, not things like [object Object]
        console.log(util.inspect(res, { depth: null }))
      })
      .catch((error) => {
        ctx.lastError = error
        this.log('Error:', error.faunaError.message)
        console.log(
          util.inspect(JSON.parse(error.faunaError.requestResult.responseRaw), {
            depth: null,
            compact: false,
          })
        )

        if (error instanceof faunadb.errors.FaunaHTTPError) {
          console.log(util.inspect(error.errors(), { depth: null }))
        }
      })
  }

  clear() {
    console.clear()
    this.repl.displayPrompt()
  }

  lastError() {
    console.log(this.repl.context.lastError)
    this.repl.displayPrompt()
  }
}

ShellCommand.description = `
Starts a FaunaDB shell
`

ShellCommand.examples = ['$ fauna shell dbname']

ShellCommand.flags = {
  ...FaunaCommand.flags,
}

ShellCommand.args = [
  {
    name: 'dbname',
    required: false,
    description: 'database name',
  },
]

module.exports = ShellCommand
