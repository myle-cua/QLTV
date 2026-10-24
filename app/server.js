const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const promClient = require('prom-client');

const app = express();
const port = process.env.PORT || 3000;

// ==============================
// 1. PROMETHEUS METRICS SETUP
// ==============================
const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register, prefix: 'library_app_' });

const httpRequestsTotal = new promClient.Counter({
  name: 'library_http_requests_total',
  help: 'Total number of HTTP requests processed by Library App',
  labelNames: ['method', 'route', 'status_code'],
});
register.registerMetric(httpRequestsTotal);

const httpRequestDuration = new promClient.Histogram({
  name: 'library_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
});
register.registerMetric(httpRequestDuration);

const totalBooksGauge = new promClient.Gauge({
  name: 'library_books_count',
  help: 'Total number of books in the library',
});
register.registerMetric(totalBooksGauge);

const activeBorrowsGauge = new promClient.Gauge({
  name: 'library_active_borrows_count',
  help: 'Current active borrowed book records',
});
register.registerMetric(activeBorrowsGauge);

// Middleware for request timing, metrics, and structured JSON logging
app.use((req, res, next) => {
  const start = process.hrtime();
  res.on('finish', () => {
    const diff = process.hrtime(start);
    const durationInSeconds = diff[0] + diff[1] / 1e9;
    const route = req.route ? req.route.path : req.path;
    const status = res.statusCode;

    httpRequestsTotal.inc({ method: req.method, route, status_code: status });
    httpRequestDuration.observe({ method: req.method, route, status_code: status }, durationInSeconds);

    // Structured JSON log for Promtail / Loki
    const logEntry = {
      timestamp: new Date().toISOString(),
      service: 'library-web-app',
      level: status >= 500 ? 'ERROR' : (status >= 400 ? 'WARN' : 'INFO'),
      method: req.method,
      path: req.originalUrl,
      status: status,
      duration_ms: (durationInSeconds * 1000).toFixed(2),
      ip: req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress,
    };
    console.log(JSON.stringify(logEntry));
  });
  next();
});

// Middleware configuration
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ==============================
// 2. DATABASE CONNECTION & RETRY
// ==============================
const pool = new Pool({
  host: process.env.DB_HOST || 'postgres',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'library_db',
  user: process.env.DB_USER || 'lib_user',
  password: process.env.DB_PASSWORD || 'LibrarySecurePass2026!',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

async function checkDatabaseConnection(retries = 10, delay = 3000) {
  for (let i = 1; i <= retries; i++) {
    try {
      const client = await pool.connect();
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        service: 'library-web-app',
        level: 'INFO',
        message: 'Successfully connected to PostgreSQL database.'
      }));
      client.release();
      updateGauges();
      return;
    } catch (err) {
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        service: 'library-web-app',
        level: 'WARN',
        message: `Database connection attempt ${i}/${retries} failed: ${err.message}. Retrying in ${delay/1000}s...`
      }));
      if (i === retries) {
        console.error(JSON.stringify({
          timestamp: new Date().toISOString(),
          service: 'library-web-app',
          level: 'ERROR',
          message: 'Could not connect to PostgreSQL after multiple attempts.'
        }));
      } else {
        await new Promise((res) => setTimeout(res, delay));
      }
    }
  }
}

async function updateGauges() {
  try {
    const booksRes = await pool.query('SELECT COUNT(*) as count FROM books');
    totalBooksGauge.set(parseInt(booksRes.rows[0].count, 10));

    const borrowRes = await pool.query("SELECT COUNT(*) as count FROM borrow_records WHERE status = 'BORROWED' OR status = 'OVERDUE'");
    activeBorrowsGauge.set(parseInt(borrowRes.rows[0].count, 10));
  } catch (err) {
    // Non-fatal, gauge update will retry on next operation
  }
}

// ==============================
// 3. API ENDPOINTS & ROUTES
// ==============================

// Prometheus metrics endpoint
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (ex) {
    res.status(500).end(ex);
  }
});

// Health check endpoint for Docker / Nginx
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'UP', database: 'CONNECTED', timestamp: new Date() });
  } catch (err) {
    res.status(503).json({ status: 'DOWN', database: 'DISCONNECTED', error: err.message });
  }
});

// Render UI Home Page
app.get('/', async (req, res) => {
  res.render('index');
});

// Stats API for Dashboard
app.get('/api/stats', async (req, res) => {
  try {
    const booksCount = await pool.query('SELECT COUNT(*) as total, COALESCE(SUM(total_copies), 0) as total_copies, COALESCE(SUM(available_copies), 0) as available_copies FROM books');
    const readersCount = await pool.query('SELECT COUNT(*) as total FROM readers');
    const borrowsCount = await pool.query("SELECT COUNT(*) as total FROM borrow_records WHERE status = 'BORROWED'");
    const overdueCount = await pool.query("SELECT COUNT(*) as total FROM borrow_records WHERE status = 'OVERDUE' OR (status = 'BORROWED' AND due_date < CURRENT_DATE)");

    res.json({
      success: true,
      data: {
        totalTitles: parseInt(booksCount.rows[0].total, 10),
        totalCopies: parseInt(booksCount.rows[0].total_copies, 10),
        availableCopies: parseInt(booksCount.rows[0].available_copies, 10),
        totalReaders: parseInt(readersCount.rows[0].total, 10),
        activeBorrows: parseInt(borrowsCount.rows[0].total, 10),
        overdueBorrows: parseInt(overdueCount.rows[0].total, 10),
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- BOOKS CRUD ---
app.get('/api/books', async (req, res) => {
  try {
    const search = req.query.q || '';
    let query = 'SELECT * FROM books ORDER BY id DESC';
    let params = [];

    if (search.trim()) {
      query = 'SELECT * FROM books WHERE title ILIKE $1 OR author ILIKE $1 OR isbn ILIKE $1 OR category ILIKE $1 ORDER BY id DESC';
      params = [`%${search}%`];
    }

    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/books', async (req, res) => {
  const { isbn, title, author, category, total_copies, published_year } = req.body;
  if (!isbn || !title || !author) {
    return res.status(400).json({ success: false, error: 'Thiếu thông tin bắt buộc (ISBN, Tựa sách, Tác giả)' });
  }

  const copies = parseInt(total_copies || 1, 10);
  try {
    const result = await pool.query(
      `INSERT INTO books (isbn, title, author, category, total_copies, available_copies, published_year)
       VALUES ($1, $2, $3, $4, $5, $5, $6) RETURNING *`,
      [isbn.trim(), title.trim(), author.trim(), category ? category.trim() : 'Tổng hợp', copies, published_year || new Date().getFullYear()]
    );
    updateGauges();
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.put('/api/books/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { title, author, category, total_copies, published_year } = req.body;

  try {
    // Lấy thông tin hiện tại để tính lại available_copies
    const current = await pool.query('SELECT total_copies, available_copies FROM books WHERE id = $1', [id]);
    if (current.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy sách' });
    }

    const diff = parseInt(total_copies, 10) - current.rows[0].total_copies;
    const newAvailable = Math.max(0, current.rows[0].available_copies + diff);

    const result = await pool.query(
      `UPDATE books 
       SET title = $1, author = $2, category = $3, total_copies = $4, available_copies = $5, published_year = $6, updated_at = NOW()
       WHERE id = $7 RETURNING *`,
      [title, author, category, total_copies, newAvailable, published_year, id]
    );
    updateGauges();
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/books/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const checkBorrow = await pool.query("SELECT COUNT(*) FROM borrow_records WHERE book_id = $1 AND status = 'BORROWED'", [id]);
    if (parseInt(checkBorrow.rows[0].count, 10) > 0) {
      return res.status(400).json({ success: false, error: 'Không thể xóa sách đang có độc giả mượn chưa trả!' });
    }

    await pool.query('DELETE FROM books WHERE id = $1', [id]);
    updateGauges();
    res.json({ success: true, message: 'Xóa sách thành công' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- READERS CRUD ---
app.get('/api/readers', async (req, res) => {
  try {
    const search = req.query.q || '';
    let query = 'SELECT * FROM readers ORDER BY id DESC';
    let params = [];

    if (search.trim()) {
      query = 'SELECT * FROM readers WHERE full_name ILIKE $1 OR card_number ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1 ORDER BY id DESC';
      params = [`%${search}%`];
    }

    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/readers', async (req, res) => {
  const { card_number, full_name, email, phone, address } = req.body;
  if (!card_number || !full_name || !email) {
    return res.status(400).json({ success: false, error: 'Thiếu thông tin bắt buộc (Mã thẻ, Họ tên, Email)' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO readers (card_number, full_name, email, phone, address)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [card_number.trim(), full_name.trim(), email.trim(), phone ? phone.trim() : null, address ? address.trim() : null]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.put('/api/readers/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { full_name, email, phone, address, status } = req.body;

  try {
    const result = await pool.query(
      `UPDATE readers 
       SET full_name = $1, email = $2, phone = $3, address = $4, status = COALESCE($5, status)
       WHERE id = $6 RETURNING *`,
      [full_name, email, phone, address, status, id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/readers/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const check = await pool.query("SELECT COUNT(*) FROM borrow_records WHERE reader_id = $1 AND status = 'BORROWED'", [id]);
    if (parseInt(check.rows[0].count, 10) > 0) {
      return res.status(400).json({ success: false, error: 'Độc giả đang mượn sách chưa trả, không thể xóa!' });
    }

    await pool.query('DELETE FROM readers WHERE id = $1', [id]);
    res.json({ success: true, message: 'Xóa độc giả thành công' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- BORROW / RETURN LOGIC ---
app.get('/api/borrow-records', async (req, res) => {
  try {
    const query = `
      SELECT br.*, 
             b.title AS book_title, b.isbn AS book_isbn,
             r.full_name AS reader_name, r.card_number AS reader_card
      FROM borrow_records br
      JOIN books b ON br.book_id = b.id
      JOIN readers r ON br.reader_id = r.id
      ORDER BY br.id DESC
    `;
    const result = await pool.query(query);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Tạo phiếu mượn sách
app.post('/api/borrow', async (req, res) => {
  const { reader_id, book_id, due_date, notes } = req.body;
  if (!reader_id || !book_id || !due_date) {
    return res.status(400).json({ success: false, error: 'Vui lòng chọn độc giả, sách và ngày hẹn trả!' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Kiểm tra sách còn bản sao không
    const bookRes = await client.query('SELECT available_copies FROM books WHERE id = $1 FOR UPDATE', [book_id]);
    if (bookRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Không tìm thấy sách!' });
    }

    const available = bookRes.rows[0].available_copies;
    if (available <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Sách này hiện đã được mượn hết, không còn bản khả dụng!' });
    }

    // Tạo phiếu mượn
    const insertRes = await client.query(
      `INSERT INTO borrow_records (reader_id, book_id, borrow_date, due_date, status, notes)
       VALUES ($1, $2, CURRENT_DATE, $3, 'BORROWED', $4) RETURNING *`,
      [reader_id, book_id, due_date, notes || null]
    );

    // Trừ 1 bản sao khả dụng
    await client.query('UPDATE books SET available_copies = available_copies - 1 WHERE id = $1', [book_id]);

    await client.query('COMMIT');
    updateGauges();
    res.status(201).json({ success: true, data: insertRes.rows[0], message: 'Tạo phiếu mượn sách thành công!' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// Trả sách
app.post('/api/return/:recordId', async (req, res) => {
  const recordId = parseInt(req.params.recordId, 10);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const recordRes = await client.query('SELECT * FROM borrow_records WHERE id = $1 FOR UPDATE', [recordId]);
    if (recordRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Không tìm thấy phiếu mượn!' });
    }

    const record = recordRes.rows[0];
    if (record.status === 'RETURNED') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Phiếu này đã trả sách từ trước!' });
    }

    // Cập nhật trạng thái phiếu mượn
    await client.query(
      `UPDATE borrow_records 
       SET status = 'RETURNED', return_date = CURRENT_DATE 
       WHERE id = $1`,
      [recordId]
    );

    // Tăng lại 1 bản sao khả dụng cho sách
    await client.query('UPDATE books SET available_copies = available_copies + 1 WHERE id = $1', [record.book_id]);

    await client.query('COMMIT');
    updateGauges();
    res.json({ success: true, message: 'Xác nhận trả sách thành công!' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// Khởi chạy server
app.listen(port, () => {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    service: 'library-web-app',
    level: 'INFO',
    message: `Library Management Web Server started on port ${port}`
  }));
  checkDatabaseConnection();
});
