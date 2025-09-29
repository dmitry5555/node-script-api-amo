// amo key
// token (issued on 09-2025), 5у

// при добавлении через api (из 1с) создается новый контакт с уникальным customerId
// сразу же передается в амо и помечается в бд как status: done

require('dotenv').config();
const token_5y = process.env.AMO_TOKEN_5Y;

const https = require('https');
const Database = require('better-sqlite3');
const db = new Database('./data/db.db', { verbose: console.log });

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
const hostname = '0.0.0.0'
const port = 3000

server.on('request', (req, res) => {
    //  endpoint для просмотра базы
    if (req.method === 'GET' && req.url === '/api/orders') {
        const allOrders = db.prepare('SELECT * FROM orders').all();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(allOrders, null, 2));
    }
});

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
            { field_code: "EMAIL", values: [{ value: order.email }] }
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
            console.log(`[Contact API] Status: ${res.statusCode}, Response:`, data);
            
            // Проверяем статус ответа
            if (res.statusCode !== 200 && res.statusCode !== 201) {
                console.error(`[Contact API] Ошибка создания контакта для orderId=${order.orderId}:`, data);
                return;
            }

            try {
                const json = JSON.parse(data);
                const contactId = json._embedded?.contacts?.[0]?.id;
                
                if (!contactId) {
                    console.error(`[Contact API] Не удалось получить contactId для orderId=${order.orderId}. Response:`, json);
                    return;
                }

                console.log(`[Contact API] Контакт создан с ID: ${contactId} для orderId=${order.orderId}`);

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
                        console.log(`[Lead API] Status: ${resLead.statusCode}, Response:`, leadDataResp);
                        
                        // Проверяем статус ответа
                        if (resLead.statusCode !== 200 && resLead.statusCode !== 201) {
                            console.error(`[Lead API] Ошибка создания сделки для orderId=${order.orderId}:`, leadDataResp);
                            return;
                        }

                        try {
                            const leadJson = JSON.parse(leadDataResp);
                            const leadId = leadJson._embedded?.leads?.[0]?.id;
                            
                            if (leadId) {
                                db.prepare(`UPDATE orders SET status='done' WHERE orderId=?`).run(order.orderId);
                                console.log(`[Lead API] Сделка создана с ID: ${leadId} для orderId=${order.orderId}. Статус обновлен на 'done'.`);
                            } else {
                                console.error(`[Lead API] Не удалось получить leadId для orderId=${order.orderId}. Response:`, leadJson);
                            }
                        } catch (err) {
                            console.error(`[Lead API] Ошибка парсинга ответа для orderId=${order.orderId}:`, err);
                        }
                    });
                });

                leadReq.on('error', (err) => {
                    console.error(`[Lead API] Ошибка запроса для orderId=${order.orderId}:`, err);
                });

                leadReq.write(JSON.stringify(leadData));
                leadReq.end();

            } catch (err) {
                console.error(`[Contact API] Ошибка обработки ответа для orderId=${order.orderId}:`, err);
            }
        });
    });

    contactReq.on('error', (err) => {
        console.error(`[Contact API] Ошибка запроса для orderId=${order.orderId}:`, err);
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
