// Reads a password without echoing it or placing it in command arguments.
const readline = require('node:readline');
const { hashAdminPassword } = require('../backend/passwords');
if (!process.stdin.isTTY) {
  const password = require('node:fs').readFileSync(0, 'utf8').replace(/\r?\n$/, '');
  if (password.length < 12) throw new Error('Password must have at least 12 characters');
  console.log(hashAdminPassword(password));
} else {
  const terminal = readline.createInterface({ input:process.stdin, output:process.stdout, terminal:true });
  terminal.question('Administrator password (at least 12 characters): ', password => {
    terminal.close(); process.stdout.write('\n');
    if (password.length < 12) { console.error('Password must have at least 12 characters'); process.exitCode=1; return; }
    console.log(hashAdminPassword(password));
  });
  terminal._writeToOutput = () => {};
}
