import sql from 'mssql';

const sqlConfig = {
  user:     process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  server:   process.env.SQL_SERVER,
  database: process.env.SQL_DATABASE,
  port:     parseInt(process.env.SQL_PORT ?? '1433', 10),
  options: {
    encrypt:                process.env.SQL_ENCRYPT !== 'false',
    trustServerCertificate: process.env.SQL_TRUST_CERT === 'true',
    connectTimeout:         15_000,
    requestTimeout:         15_000,
  },
  pool: {
    max:               10,
    min:               0,
    idleTimeoutMillis: 30_000,
  },
};

let pool = null;

const getPool = async () => {
  if (pool && pool.connected) return pool;
  pool = await sql.connect(sqlConfig);
  return pool;
};

export { getPool, sql };
