const chalk = require('chalk');

const logger = {
  info: (msg) => console.log(chalk.cyan(`[INFO] ${msg}`)),
  success: (msg) => console.log(chalk.green(`[SUCCESS] ${msg}`)),
  warn: (msg) => console.log(chalk.yellow(`[WARN] ${msg}`)),
  error: (msg, err) => {
    console.error(chalk.red(`[ERROR] ${msg}`));
    if (err) {
      console.error(chalk.red(err.stack || err));
    }
  }
};

module.exports = logger;
