-- Khởi tạo Database Quản Lý Thư Viện (Library Management System)
-- Tự động chạy khi khởi động container PostgreSQL qua /docker-entrypoint-initdb.d/

-- 1. Bảng Sách (books)
CREATE TABLE IF NOT EXISTS books (
    id SERIAL PRIMARY KEY,
    isbn VARCHAR(30) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    author VARCHAR(150) NOT NULL,
    category VARCHAR(100) NOT NULL,
    total_copies INT NOT NULL DEFAULT 1 CHECK (total_copies >= 0),
    available_copies INT NOT NULL DEFAULT 1 CHECK (available_copies >= 0 AND available_copies <= total_copies),
    published_year INT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Bảng Độc giả (readers)
CREATE TABLE IF NOT EXISTS readers (
    id SERIAL PRIMARY KEY,
    card_number VARCHAR(50) UNIQUE NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    phone VARCHAR(25),
    address VARCHAR(255),
    status VARCHAR(20) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Bảng Phiếu mượn / trả (borrow_records)
CREATE TABLE IF NOT EXISTS borrow_records (
    id SERIAL PRIMARY KEY,
    reader_id INT NOT NULL REFERENCES readers(id) ON DELETE RESTRICT,
    book_id INT NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
    borrow_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE NOT NULL,
    return_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'BORROWED' CHECK (status IN ('BORROWED', 'RETURNED', 'OVERDUE')),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes hỗ trợ tìm kiếm nhanh
CREATE INDEX IF NOT EXISTS idx_books_title ON books(title);
CREATE INDEX IF NOT EXISTS idx_books_isbn ON books(isbn);
CREATE INDEX IF NOT EXISTS idx_readers_card ON readers(card_number);
CREATE INDEX IF NOT EXISTS idx_borrow_status ON borrow_records(status);

-- Dữ liệu mẫu (Seed Data)
INSERT INTO books (isbn, title, author, category, total_copies, available_copies, published_year) VALUES
('978-0132350884', 'Clean Code: A Handbook of Agile Software Craftsmanship', 'Robert C. Martin', 'Kỹ thuật phần mềm', 5, 4, 2008),
('978-0201633610', 'Design Patterns: Elements of Reusable Object-Oriented Software', 'Erich Gamma et al.', 'Kiến trúc phần mềm', 3, 2, 1994),
('978-0134685991', 'Effective Java (3rd Edition)', 'Joshua Bloch', 'Lập trình Java', 6, 6, 2017),
('978-1491950296', 'Designing Data-Intensive Applications', 'Martin Kleppmann', 'Cơ sở dữ liệu & Phân tán', 4, 3, 2017),
('978-1449373320', 'Designing Distributed Systems', 'Brendan Burns', 'Cloud & DevOps', 5, 5, 2018),
('978-0135957059', 'The Pragmatic Programmer', 'David Thomas, Andrew Hunt', 'Kỹ năng lập trình', 4, 4, 2019)
ON CONFLICT (isbn) DO NOTHING;

INSERT INTO readers (card_number, full_name, email, phone, address) VALUES
('LIB-2026-001', 'Nguyễn Văn An', 'an.nguyen@email.com', '0901234567', 'Hà Nội, Việt Nam'),
('LIB-2026-002', 'Trần Thị Bình', 'binh.tran@email.com', '0912345678', 'Đà Nẵng, Việt Nam'),
('LIB-2026-003', 'Lê Hoàng Cường', 'cuong.le@email.com', '0923456789', 'TP. Hồ Chí Minh, Việt Nam'),
('LIB-2026-004', 'Phạm Minh Đức', 'duc.pham@email.com', '0934567890', 'Cần Thơ, Việt Nam')
ON CONFLICT (card_number) DO NOTHING;

INSERT INTO borrow_records (reader_id, book_id, borrow_date, due_date, status, notes) VALUES
(1, 1, CURRENT_DATE - INTERVAL '5 days', CURRENT_DATE + INTERVAL '9 days', 'BORROWED', 'Mượn phục vụ đề tài môn học'),
(2, 2, CURRENT_DATE - INTERVAL '10 days', CURRENT_DATE + INTERVAL '4 days', 'BORROWED', 'Mượn nghiên cứu kiến trúc'),
(3, 4, CURRENT_DATE - INTERVAL '18 days', CURRENT_DATE - INTERVAL '4 days', 'OVERDUE', 'Quá hạn trả 4 ngày')
ON CONFLICT DO NOTHING;
