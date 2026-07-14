-- Oracle: dados fictícios para smoke test do omni-sql
-- Roda como APP_USER (OMNI) no gvenzl/oracle-xe

-- O runner da imagem abre o seed no CDB raiz (XE), enquanto APP_USER vive no
-- PDB XEPDB1. Selecionar ambos evita criar os objetos no container/schema SYS.
ALTER SESSION SET CONTAINER = XEPDB1;
ALTER SESSION SET CURRENT_SCHEMA = OMNI;

-- ── Tabelas ──

CREATE TABLE customers (
    id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        VARCHAR2(100) NOT NULL,
    email       VARCHAR2(200) UNIQUE NOT NULL,
    city        VARCHAR2(100),
    created_at  TIMESTAMP DEFAULT SYSTIMESTAMP
);

CREATE TABLE products (
    id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        VARCHAR2(100) NOT NULL,
    price       NUMBER(10,2) NOT NULL,
    category    VARCHAR2(50)
);

CREATE TABLE orders (
    id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id NUMBER NOT NULL REFERENCES customers(id),
    order_date  DATE DEFAULT TRUNC(SYSDATE),
    total       NUMBER(12,2)
);

CREATE TABLE order_items (
    id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id    NUMBER NOT NULL REFERENCES orders(id),
    product_id  NUMBER NOT NULL REFERENCES products(id),
    quantity    NUMBER DEFAULT 1 NOT NULL,
    unit_price  NUMBER(10,2) NOT NULL
);

-- ── Dados ──

INSERT INTO customers (name, email, city) VALUES ('Alice Silva',   'alice@example.com',  'São Paulo');
INSERT INTO customers (name, email, city) VALUES ('Bob Santos',    'bob@example.com',    'Rio de Janeiro');
INSERT INTO customers (name, email, city) VALUES ('Carol Oliveira','carol@example.com',  'Belo Horizonte');
INSERT INTO customers (name, email, city) VALUES ('Dave Pereira',  'dave@example.com',   'Curitiba');
INSERT INTO customers (name, email, city) VALUES ('Eve Lima',      'eve@example.com',    'Porto Alegre');

INSERT INTO products (name, price, category) VALUES ('Notebook Pro',    4999.90, 'Eletrônicos');
INSERT INTO products (name, price, category) VALUES ('Mouse Wireless',   129.90, 'Eletrônicos');
INSERT INTO products (name, price, category) VALUES ('Cadeira Ergo',    1299.00, 'Mobília');
INSERT INTO products (name, price, category) VALUES ('Monitor 27"',     2199.00, 'Eletrônicos');
INSERT INTO products (name, price, category) VALUES ('Teclado Mec',      349.90, 'Eletrônicos');

INSERT INTO orders (customer_id, order_date, total) VALUES (1, DATE '2026-01-15', 5129.80);
INSERT INTO orders (customer_id, order_date, total) VALUES (2, DATE '2026-02-20', 1648.90);
INSERT INTO orders (customer_id, order_date, total) VALUES (1, DATE '2026-03-10', 349.90);
INSERT INTO orders (customer_id, order_date, total) VALUES (3, DATE '2026-04-05', 7198.80);
INSERT INTO orders (customer_id, order_date, total) VALUES (4, DATE '2026-05-12', 129.90);

INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (1, 1, 1, 4999.90);
INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (1, 2, 1,  129.90);
INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (2, 3, 1, 1299.00);
INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (2, 5, 1,  349.90);
INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (3, 5, 1,  349.90);
INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (4, 4, 2, 2199.00);
INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (4, 2, 1,  129.90);
INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (5, 2, 1,  129.90);

COMMIT;

-- ── Índices ──

CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_order_items_order ON order_items(order_id);

-- ── View ──

CREATE OR REPLACE VIEW order_summary AS
SELECT
    o.id AS order_id,
    c.name AS customer_name,
    c.city,
    o.order_date,
    o.total,
    (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
FROM orders o
JOIN customers c ON c.id = o.customer_id;

-- ── Função ──

CREATE OR REPLACE FUNCTION get_customer_total(p_customer_id IN NUMBER)
RETURN NUMBER
IS
    v_total NUMBER;
BEGIN
    SELECT COALESCE(SUM(total), 0) INTO v_total FROM orders WHERE customer_id = p_customer_id;
    RETURN v_total;
END;
/
