const app = require('./app');

const PORT = Number(process.env.PORT) || 3002;
app.listen(PORT, () => console.log(`SSK ERP API on :${PORT}`));
