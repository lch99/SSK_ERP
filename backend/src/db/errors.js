// A request the rules refuse: 400 with every reason (as the demo store gives them).
class ValidationError extends Error {
  constructor(errors) {
    const list = Array.isArray(errors) ? errors : [errors];
    super(list[0]);
    this.errors = list;
  }
}

// A delete refused because other records still point at the row (MySQL 1451, SQLite FK).
const isInUse = err => err?.errno === 1451 || err?.code === 'ER_ROW_IS_REFERENCED_2'
  || /FOREIGN KEY constraint failed/i.test(err?.message || '');

module.exports = { ValidationError, isInUse };
