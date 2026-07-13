/**
 * generators/db-config.js
 *
 * Central registry for the configurable DB engine used by `dbQuery` steps.
 *
 * A tester sets the engine once at the project level
 * (`project.dbConfig.engine`) and supplies the real connection at run time via
 * environment variables — credentials are NEVER written into generated code:
 *
 *   - JDBC engines (Java + TestNG):  DB_URL / DB_USER / DB_PASS
 *   - Node engines (Playwright TS/JS): DB_URL (pg/mysql/mssql) or DB_FILE (sqlite)
 *
 * The default engine is `auto` = zero-setup in-memory (H2 for Java,
 * better-sqlite3 for Node) so a freshly generated project runs with no external
 * database. Choose postgresql / mysql / sqlserver to target a real DB — that
 * only swaps the driver dependency (and, for Node, the client code); the query +
 * row-count assertion stay the same.
 */

// version pins kept conservative + current-ish; testers can bump freely.
export const DB_ENGINES = {
  auto: {
    id: 'auto',
    label: 'Auto (zero-setup: H2 / SQLite in-memory)',
    java: {
      // in-memory H2 — no server needed
      pomDep: { groupId: 'com.h2database', artifactId: 'h2', version: '2.2.224', scope: 'test' },
      urlDefault: 'jdbc:h2:mem:testdb;DB_CLOSE_DELAY=-1',
    },
    node: { pkg: { name: 'better-sqlite3', version: '^11.3.0' }, driver: 'sqlite' },
  },
  postgresql: {
    id: 'postgresql',
    label: 'PostgreSQL',
    java: {
      pomDep: { groupId: 'org.postgresql', artifactId: 'postgresql', version: '42.7.4', scope: 'test' },
      urlDefault: 'jdbc:postgresql://localhost:5432/testdb',
    },
    node: { pkg: { name: 'pg', version: '^8.13.0' }, driver: 'pg' },
  },
  mysql: {
    id: 'mysql',
    label: 'MySQL',
    java: {
      pomDep: { groupId: 'com.mysql', artifactId: 'mysql-connector-j', version: '8.4.0', scope: 'test' },
      urlDefault: 'jdbc:mysql://localhost:3306/testdb',
    },
    node: { pkg: { name: 'mysql2', version: '^3.11.0' }, driver: 'mysql' },
  },
  sqlserver: {
    id: 'sqlserver',
    label: 'SQL Server',
    java: {
      pomDep: { groupId: 'com.microsoft.sqlserver', artifactId: 'mssql-jdbc', version: '12.8.1.jre11', scope: 'test' },
      urlDefault: 'jdbc:sqlserver://localhost:1433;databaseName=testdb;encrypt=false',
    },
    node: { pkg: { name: 'mssql', version: '^11.0.1' }, driver: 'mssql' },
  },
};

/** Resolve the engine id from a project (with optional per-step override). */
export function resolveDbEngine(projectData = {}, step = null) {
  const fromStep = step && (step.dbEngine || step.engine);
  const fromProject = projectData && projectData.dbConfig && projectData.dbConfig.engine;
  const id = String(fromStep || fromProject || 'auto').toLowerCase();
  return DB_ENGINES[id] ? id : 'auto';
}

/** Maven <dependency> snippet for the engine's JDBC driver. */
export function javaDbDependencyXml(engineId) {
  const e = DB_ENGINES[engineId] || DB_ENGINES.auto;
  const d = e.java.pomDep;
  return `        <!-- [ZAC] ${e.label} JDBC driver for dbQuery steps. Set DB_URL/DB_USER/DB_PASS at run time. -->
        <dependency>
            <groupId>${d.groupId}</groupId>
            <artifactId>${d.artifactId}</artifactId>
            <version>${d.version}</version>${d.scope ? `\n            <scope>${d.scope}</scope>` : ''}
        </dependency>`;
}

/** Default JDBC URL for the engine (only a fallback — DB_URL env wins). */
export function javaDbUrlDefault(engineId) {
  return (DB_ENGINES[engineId] || DB_ENGINES.auto).java.urlDefault;
}

/** npm dependency {name,version} for the engine's Node client. */
export function nodeDbDependency(engineId) {
  return (DB_ENGINES[engineId] || DB_ENGINES.auto).node.pkg;
}

/**
 * Node connect+query+row-count-assert statements for the engine.
 * `sqlExpr` / `expectedExpr` are raw JS expressions (a param name or a literal).
 * Returns a string of statements safe to drop inside an async function body.
 */
export function nodeDbQuerySnippet(engineId, { sqlExpr, expectedExpr, indent = '  ' }) {
  const driver = (DB_ENGINES[engineId] || DB_ENGINES.auto).node.driver;
  const i = indent;
  const mismatch = `throw new Error('DB row count mismatch for [' + ${sqlExpr} + ']: expected ' + ${expectedExpr} + ' but got ' + _n);`;
  if (driver === 'sqlite') {
    return [
      `${i}const _Db = (await import('better-sqlite3')).default;`,
      `${i}const _db = new _Db(process.env.DB_FILE || ':memory:');`,
      `${i}try {`,
      `${i}  const _n = _db.prepare(${sqlExpr}).all().length;`,
      `${i}  if (_n !== ${expectedExpr}) ${mismatch}`,
      `${i}} finally { _db.close(); }`,
    ].join('\n');
  }
  if (driver === 'pg') {
    return [
      `${i}const { Client } = await import('pg');`,
      `${i}const _c = new Client({ connectionString: process.env.DB_URL });`,
      `${i}await _c.connect();`,
      `${i}try {`,
      `${i}  const _n = (await _c.query(${sqlExpr})).rowCount;`,
      `${i}  if (_n !== ${expectedExpr}) ${mismatch}`,
      `${i}} finally { await _c.end(); }`,
    ].join('\n');
  }
  if (driver === 'mysql') {
    return [
      `${i}const _mysql = await import('mysql2/promise');`,
      `${i}const _c = await _mysql.createConnection(process.env.DB_URL);`,
      `${i}try {`,
      `${i}  const [_rows] = await _c.query(${sqlExpr});`,
      `${i}  const _n = Array.isArray(_rows) ? _rows.length : 0;`,
      `${i}  if (_n !== ${expectedExpr}) ${mismatch}`,
      `${i}} finally { await _c.end(); }`,
    ].join('\n');
  }
  // mssql
  return [
    `${i}const _mssql = (await import('mssql')).default;`,
    `${i}const _pool = await _mssql.connect(process.env.DB_URL);`,
    `${i}try {`,
    `${i}  const _n = (await _pool.request().query(${sqlExpr})).recordset.length;`,
    `${i}  if (_n !== ${expectedExpr}) ${mismatch}`,
    `${i}} finally { await _pool.close(); }`,
  ].join('\n');
}
