-- SQL Server: dados fictícios para smoke test do omni-sql
-- Monta como volume e roda via entrypoint custom (init-script.sql)
-- Primeiro cria o banco, depois usa-o:

USE master;
GO

IF DB_ID('omni_test') IS NULL
    CREATE DATABASE omni_test;
GO

USE omni_test;
GO

-- ── Tabelas ──

CREATE TABLE customers (
    id          INT IDENTITY(1,1) PRIMARY KEY,
    name        NVARCHAR(100) NOT NULL,
    email       NVARCHAR(200) UNIQUE NOT NULL,
    city        NVARCHAR(100),
    created_at  DATETIME2 DEFAULT SYSUTCDATETIME()
);

CREATE TABLE products (
    id          INT IDENTITY(1,1) PRIMARY KEY,
    name        NVARCHAR(100) NOT NULL,
    price       DECIMAL(10, 2) NOT NULL,
    category    NVARCHAR(50)
);

CREATE TABLE orders (
    id          INT IDENTITY(1,1) PRIMARY KEY,
    customer_id INT NOT NULL FOREIGN KEY REFERENCES customers(id),
    order_date  DATE DEFAULT CAST(GETUTCDATE() AS DATE),
    total       DECIMAL(12, 2)
);

CREATE TABLE order_items (
    id          INT IDENTITY(1,1) PRIMARY KEY,
    order_id    INT NOT NULL FOREIGN KEY REFERENCES orders(id),
    product_id  INT NOT NULL FOREIGN KEY REFERENCES products(id),
    quantity    INT NOT NULL DEFAULT 1,
    unit_price  DECIMAL(10, 2) NOT NULL
);

-- ── Dados ──

INSERT INTO customers (name, email, city) VALUES
    (N'Alice Silva',   N'alice@example.com',  N'São Paulo'),
    (N'Bob Santos',    N'bob@example.com',    N'Rio de Janeiro'),
    (N'Carol Oliveira',N'carol@example.com',  N'Belo Horizonte'),
    (N'Dave Pereira',  N'dave@example.com',   N'Curitiba'),
    (N'Eve Lima',      N'eve@example.com',    N'Porto Alegre');

INSERT INTO products (name, price, category) VALUES
    (N'Notebook Pro',    4999.90, N'Eletrônicos'),
    (N'Mouse Wireless',   129.90, N'Eletrônicos'),
    (N'Cadeira Ergo',    1299.00, N'Mobília'),
    (N'Monitor 27"',     2199.00, N'Eletrônicos'),
    (N'Teclado Mec',      349.90, N'Eletrônicos');

INSERT INTO orders (customer_id, order_date, total) VALUES
    (1, '2026-01-15', 5129.80),
    (2, '2026-02-20', 1648.90),
    (1, '2026-03-10', 349.90),
    (3, '2026-04-05', 7198.80),
    (4, '2026-05-12', 129.90);

INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES
    (1, 1, 1, 4999.90),
    (1, 2, 1,  129.90),
    (2, 3, 1, 1299.00),
    (2, 5, 1,  349.90),
    (3, 5, 1,  349.90),
    (4, 4, 2, 2199.00),
    (4, 2, 1,  129.90),
    (5, 2, 1,  129.90);

-- ── Índices ──

CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_order_items_order ON order_items(order_id);

-- ── View ──

GO
CREATE VIEW order_summary AS
SELECT
    o.id AS order_id,
    c.name AS customer_name,
    c.city,
    o.order_date,
    o.total,
    (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
FROM orders o
JOIN customers c ON c.id = o.customer_id;
GO

-- ── Stored Procedure ──

CREATE PROCEDURE get_customer_total
    @customer_id INT,
    @total DECIMAL(12,2) OUTPUT
AS
BEGIN
    SELECT @total = COALESCE(SUM(total), 0) FROM orders WHERE customer_id = @customer_id;
END;
GO
