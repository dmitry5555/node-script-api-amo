// amo key
// token (issued on 09-2025), 5у

// при добавлении через api (из 1с) создается новый контакт с уникальным customerId
// сразу же передается в амо и помечается в бд как status: done

require('dotenv').config();
const token_5y = process.env.AMO_TOKEN_5Y;

const https = require('https');
const Database = require('better-sqlite3');
const db = new Database('db.db', { verbose: console.log });

db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        orderId TEXT UNIQUE,
        customerName TEXT,
        phone TEXT,
        email TEXT,
        total REAL,
        status TEXT DEFAULT 'pending',
        createdAt TEXT,
        customerId TEXT UNIQUE
    )
`)

const http = require('node:http')
const hostname = 'localhost'
const port = 3000

const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/orders') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const order = JSON.parse(body);

                // Проверяем на дубли по customerId + orderId
                const existingСustomer = db.prepare(
                    'SELECT 1 FROM orders WHERE customerId = ?'
                ).get(order.customerId);

                const existingOrder = db.prepare(
                    'SELECT 1 FROM orders WHERE orderId = ?'
                ).get(order.orderId);


                if (existingСustomer) {
                    res.writeHead(409, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({
                        status: 'exists',
                        message: `Пользователь с customerId ${order.customerId} уже существует.`
                    }));
                }
                if (existingOrder) {
                    res.writeHead(409, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({
                        status: 'exists',
                        message: `Заказ с orderId ${order.orderId} уже существует.`
                }));
            }

                db.prepare(`
                    INSERT OR IGNORE INTO orders (orderId, customerId, customerName, phone, email, total, createdAt)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `).run(order.orderId, order.customerId, order.customerName, order.phone, order.email, order.total, new Date().toISOString());

                sendOrderToAmo(order); // сразу отправляем в amoCRM

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok' }));
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'error', message: err.message }));
            }
        });
    } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'not found' }));
    }

})

server.listen(port, hostname, () => {
    console.log('working ✨')
})


// отправка в амо
function sendOrderToAmo(order) {
    const contactData = [{
        name: order.customerName,
        custom_fields_values: [
            { field_code: "PHONE", values: [{ value: order.phone }] },
            { field_code: "EMAIL", values: [{ value: order.email }] },
            // уникальный идентификатор из 1с но нужно создавать поле в АМО
            // { field_code: "EXT_CUST_ID", values: [{ value: order.customerId }] }
        ]
    }];

    const contactReq = https.request({
        hostname: 'beregul.amocrm.ru',
        path: '/api/v4/contacts',
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + token_5y,
            'Content-Type': 'application/json'
        }
    }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            try {
                const json = JSON.parse(data);
                const contactId = json._embedded?.contacts?.[0]?.id;
                if (!contactId) return console.error('Не удалось получить contactId');

                // создаём сделку
                const leadData = [{
                    name: `Заказ #${order.orderId}`,
                    price: order.total,
                    _embedded: { contacts: [{ id: contactId }] }
                }];

                const leadReq = https.request({
                    hostname: 'beregul.amocrm.ru',
                    path: '/api/v4/leads',
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer ' + token_5y,
                        'Content-Type': 'application/json'
                    }
                }, resLead => {
                    let leadDataResp = '';
                    resLead.on('data', chunk => leadDataResp += chunk);
                    resLead.on('end', () => {
                        db.prepare(`UPDATE orders SET status='done' WHERE orderId=?`).run(order.orderId);
                        console.log('Сделка создана:', leadDataResp);
                    });
                });

                leadReq.write(JSON.stringify(leadData));
                leadReq.end();
            } catch (err) {
                console.error(err);
            }
        });
    });

    contactReq.write(JSON.stringify(contactData));
    contactReq.end();
}

// каждые 5 минут проверяем наличие заказов в статусе 'pending' и отправляем их в amoCRM
function processPendingOrders() {
    const pendingOrders = db.prepare("SELECT * FROM orders WHERE status = 'pending'").all();

    if (pendingOrders.length > 0) {
        console.log(`Найдено ${pendingOrders.length} заказов в статусе 'pending'.`);
        pendingOrders.forEach(order => {
            sendOrderToAmo(order);
        });
    } else {
        console.log("Нет заказов в статусе 'pending'.");
    }
}

// setInterval(processPendingOrders, 5 * 60 * 1000);
