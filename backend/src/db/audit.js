const db = require('./connection');

// Record one change. `q` lets a caller log inside its own transaction.
async function audit(req, { action, entity, entityId = null, detail = null }, q = db) {
  await q('audit_log').insert({
    user_id: req?.user?.id ?? null,
    username: req?.user?.username ?? null,
    action, entity,
    entity_id: entityId == null ? null : String(entityId),
    detail: detail == null ? null : JSON.stringify(detail),
  });
}

module.exports = { audit };
