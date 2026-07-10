-- MySQL: dados fictícios para smoke test do omni-sql
-- Roda via docker-entrypoint-initdb.d

-- ── Tabelas ──

CREATE TABLE customers (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    email       VARCHAR(200) UNIQUE NOT NULL,
    city        VARCHAR(100),
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE products (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    price       DECIMAL(10, 2) NOT NULL,
    category    VARCHAR(50)
);

CREATE TABLE orders (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT NOT NULL,
    order_date  DATE DEFAULT (CURRENT_DATE),
    total       DECIMAL(12, 2),
    FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE order_items (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    order_id    INT NOT NULL,
    product_id  INT NOT NULL,
    quantity    INT NOT NULL DEFAULT 1,
    unit_price  DECIMAL(10, 2) NOT NULL,
    FOREIGN KEY (order_id)   REFERENCES orders(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
);

-- ── Dados ──

INSERT INTO customers (name, email, city) VALUES
    ('Alice Silva',   'alice@example.com',  'São Paulo'),
    ('Bob Santos',    'bob@example.com',    'Rio de Janeiro'),
    ('Carol Oliveira','carol@example.com',  'Belo Horizonte'),
    ('Dave Pereira',  'dave@example.com',   'Curitiba'),
    ('Eve Lima',      'eve@example.com',    'Porto Alegre');

INSERT INTO products (name, price, category) VALUES
    ('Notebook Pro',    4999.90, 'Eletrônicos'),
    ('Mouse Wireless',   129.90, 'Eletrônicos'),
    ('Cadeira Ergo',    1299.00, 'Mobília'),
    ('Monitor 27"',     2199.00, 'Eletrônicos'),
    ('Teclado Mec',      349.90, 'Eletrônicos');

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

-- ── Stored Procedure ──

DELIMITER //
CREATE PROCEDURE get_customer_total(IN p_customer_id INT, OUT p_total DECIMAL(12,2))
BEGIN
    SELECT COALESCE(SUM(total), 0) INTO p_total FROM orders WHERE customer_id = p_customer_id;
END //
DELIMITER ;
