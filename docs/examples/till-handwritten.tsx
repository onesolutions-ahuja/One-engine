// Till page — written by hand, as a normal React + TypeScript app.
// No metadata, no formula engine, no page builder. This is what "fast" looks like.

import { useEffect, useMemo, useRef, useState } from "react";

/* ---------- Types ---------- */
type Category = { id: string; name: string };
type Product  = { id: string; name: string; price: number; imageUrl: string;
                  categoryId: string; barcode: string; ageRestricted: boolean };
type Line     = { id: string; productId: string; name: string; unitPrice: number;
                  originalPrice: number; qty: number };
type Cart     = { id: string; lines: Line[]; discountPercent: number; discountAmount: number };

/* ---------- Server calls (ONE request per user action) ---------- */
const api = async <T,>(path: string, body?: unknown): Promise<T> => {
  const res = await fetch("/api/till" + path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

/* ---------- Money and totals: plain maths, no server round trip ---------- */
const money = (n: number) => "£" + n.toFixed(2);
const lineTotal = (l: Line) => l.unitPrice * l.qty;
const lineDiscount = (l: Line) => (l.originalPrice - l.unitPrice) * l.qty;

function totals(cart: Cart) {
  const subtotal = cart.lines.reduce((sum, l) => sum + lineTotal(l), 0);
  const discount = cart.discountPercent > 0
    ? +(subtotal * cart.discountPercent / 100).toFixed(2)
    : Math.min(cart.discountAmount, subtotal);
  const total = Math.max(0, subtotal - discount);
  return { subtotal, discount, vat: +(total / 6).toFixed(2), total };
}

/* ---------- The page ---------- */
export default function TillPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts]     = useState<Product[]>([]);
  const [cart, setCart]             = useState<Cart>({ id: "", lines: [], discountPercent: 0, discountAmount: 0 });
  const [category, setCategory]     = useState<string | null>(null);   // null = All
  const [search, setSearch]         = useState("");
  const [selectedLine, setSelected] = useState<string | null>(null);
  const searchBox = useRef<HTMLInputElement>(null);

  // Page open: ONE request returns categories, products and the open cart.
  useEffect(() => {
    api<{ categories: Category[]; products: Product[]; cart: Cart }>("/bootstrap")
      .then(d => { setCategories(d.categories); setProducts(d.products); setCart(d.cart); });
  }, []);

  // Filtering happens in memory: instant, no request.
  // (With 10k+ products: same code, but /products?search=&category= with 50 rows a page.)
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length >= 3) return products.filter(p => p.name.toLowerCase().includes(q));
    return category ? products.filter(p => p.categoryId === category) : products;
  }, [products, category, search]);

  const t = totals(cart);

  /* Every action: change the screen FIRST, then save in the background.
     If the save fails, put the old cart back. */
  async function change(next: Cart, save: () => Promise<Cart>) {
    const before = cart;
    setCart(next);                       // 0 ms: the cashier sees it now
    try { setCart(await save()); }       // server confirms (ids, real totals)
    catch (e) { setCart(before); alert((e as Error).message); }
  }

  function addProduct(p: Product) {
    const existing = cart.lines.find(l => l.productId === p.id);
    const lines = existing
      ? cart.lines.map(l => l === existing ? { ...l, qty: l.qty + 1 } : l)
      : [...cart.lines, { id: "tmp-" + p.id, productId: p.id, name: p.name,
                         unitPrice: p.price, originalPrice: p.price, qty: 1 }];
    change({ ...cart, lines }, () => api<Cart>("/cart/add", { productId: p.id }));
  }

  function setQty(line: Line, qty: number) {
    const lines = qty <= 0 ? cart.lines.filter(l => l !== line)
                           : cart.lines.map(l => l === line ? { ...l, qty } : l);
    change({ ...cart, lines }, () => api<Cart>("/cart/qty", { lineId: line.id, qty }));
  }

  function discountLine(line: Line, percent: number) {
    const unitPrice = +(line.originalPrice * (100 - percent) / 100).toFixed(2);
    const lines = cart.lines.map(l => l === line ? { ...l, unitPrice } : l);
    change({ ...cart, lines }, () => api<Cart>("/cart/line-discount", { lineId: line.id, percent }));
  }

  function discountSale(percent: number) {
    change({ ...cart, discountPercent: percent, discountAmount: 0 },
           () => api<Cart>("/cart/discount", { percent }));
  }

  function scan(code: string) {
    const p = products.find(x => x.barcode === code);
    if (p) addProduct(p);
    if (searchBox.current) searchBox.current.value = "";
    setSearch("");
  }

  const hold  = () => change({ ...cart, lines: [] }, () => api<Cart>("/cart/hold", {}));
  const clear = () => change({ ...cart, lines: [] }, () => api<Cart>("/cart/clear", {}));
  const pay   = (method: "Cash" | "Card") =>
    cart.lines.length && api("/cart/pay", { method }).then(() => setCart({ ...cart, lines: [] }));

  return (
    <div className="till">
      <header>
        <input ref={searchBox} placeholder="Search product or scan barcode"
               onChange={e => setSearch(e.target.value)}
               onKeyDown={e => e.key === "Enter" && scan(e.currentTarget.value.trim())} />
      </header>

      <nav className="tabs">
        <button className={category === null ? "on" : ""} onClick={() => setCategory(null)}>All</button>
        {categories.map(c =>
          <button key={c.id} className={category === c.id ? "on" : ""}
                  onClick={() => setCategory(c.id)}>{c.name}</button>)}
      </nav>

      <section className="grid">
        {visible.map(p =>
          <button key={p.id} className="card" onClick={() => addProduct(p)}>
            <img src={p.imageUrl} alt="" loading="lazy" />
            {p.ageRestricted && <span className="badge">18+</span>}
            <b>{money(p.price)}</b><span>{p.name}</span>
          </button>)}
      </section>

      <aside className="cart">
        <table>
          <thead><tr><th>Item</th><th>Each</th><th>Qty</th><th>Total</th><th>Discount</th></tr></thead>
          <tbody>
            {cart.lines.map(l =>
              <tr key={l.id} className={selectedLine === l.id ? "on" : ""} onClick={() => setSelected(l.id)}>
                <td>{l.name}</td>
                <td>{money(l.unitPrice)}</td>
                <td><button onClick={() => setQty(l, l.qty - 1)}>−</button>{l.qty}
                    <button onClick={() => setQty(l, l.qty + 1)}>+</button></td>
                <td>{money(lineTotal(l))}</td>
                <td>{lineDiscount(l) > 0 ? "-" + money(lineDiscount(l)) : "—"}</td>
              </tr>)}
          </tbody>
        </table>

        {selectedLine && <div className="line-actions">
          <button onClick={() => setQty(cart.lines.find(l => l.id === selectedLine)!, 0)}>Remove</button>
          {[5, 10, 15, 20].map(n =>
            <button key={n} onClick={() => discountLine(cart.lines.find(l => l.id === selectedLine)!, n)}>{n}%</button>)}
        </div>}

        <dl className="totals">
          <dt>Subtotal</dt><dd>{money(t.subtotal)}</dd>
          <dt>Discount</dt><dd>{money(t.discount)}</dd>
          <dt>VAT included (20%)</dt><dd>{money(t.vat)}</dd>
          <dt>Total to pay</dt><dd>{money(t.total)}</dd>
        </dl>

        <button onClick={() => discountSale(10)}>Discount</button>
        <button onClick={hold}>Hold</button>
        <button onClick={clear}>Clear sale</button>
        <button onClick={() => pay("Cash")}>Cash</button>
        <button onClick={() => pay("Card")}>Card</button>
      </aside>
    </div>
  );
}

/* ================= SERVER (Node + Postgres), same app =================
   Each action = ONE function = ONE SQL transaction = ONE round trip.

app.post("/api/till/cart/add", async (req, res) => {
  const cart = await db.tx(async sql => {
    const cartId = await sql.openCart(req.session.id);                 // get or create, 1 query
    await sql`INSERT INTO cart_line (cart_id, product_id, name, unit_price, original_price, qty)
              SELECT ${cartId}, id, name, price, price, 1 FROM product WHERE id = ${req.body.productId}
              ON CONFLICT (cart_id, product_id) DO UPDATE SET qty = cart_line.qty + 1`;
    return sql.readCart(cartId);                                       // lines + totals, 1 query
  });
  res.json(cart);                                                      // ~10-30 ms on the server
});
*/
