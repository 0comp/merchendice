    const products=[
  {id:'dove-tee',name:'Dove Line Tee',category:'T-shirts',badge:'New',model:'6aa829f98282e23ff70c2186',design:'97933',slug:'dove-line-drawing-tee-minimal-bird-chest-print',camera:'front',colors:[['White','22073'],['Light Pink','21897'],['Sand','22009'],['Light Blue','21889'],['Carolina Blue','21761'],['Indigo Blue','22145'],['Royal','21985'],['Dark Heather','21809'],['Navy','21929'],['Charcoal','21769']],sizes:['S','M','L','XL','2XL','3XL'],description:'A clean, vintage-feel cotton tee with a small, hand-drawn swallow sketch at the chest.'},
  {id:'bird-hoodie',name:'Finch Hoodie',category:'Sweatshirts',badge:'New',model:'6aa835e16fe418097a0114c1',design:'98424',slug:'bird-on-branch-hoodie-minimal-colorful-finch-graphic-sweatshirt',camera:'front',colors:[['White','32912'],['Sand','42166'],['Sport Grey','32904'],['Navy','32896'],['Black','32920']],sizes:['S','M','L','XL','2XL','3XL','4XL','5XL'],description:'A soft midweight hoodie with a small, colorful bird design and an easy everyday fit.'},
  {id:'canvas-tote',name:'Songbird Canvas Tote',category:'Accessories',badge:'',model:'6aa835e18875f83d480655a4',design:'93895',slug:'canvas-tote-bag-minimal-colorful-bird-illustration-eco-shopper',camera:'front',colors:[['Natural','101409'],['Black','103598']],sizes:['15” × 16”'],description:'A sturdy cotton canvas tote with a small bird detail and long shoulder handles.'},
  {id:'crewneck',name:'Songbird Crewneck',category:'Sweatshirts',badge:'Limited',model:'6aa835e25cd33d8be101b8d7',design:'98502',slug:'minimal-colorful-bird-crewneck-sweatshirt',camera:'front',colors:[['White','25458'],['Sand','25456'],['Sport Grey','25457'],['Navy','25450'],['Black','25459']],sizes:['S','M','L','XL','2XL','3XL','4XL','5XL'],description:'A soft crewneck sweatshirt with a small, cheerful songbird embroidered on the chest.'},
  {id:'songbird-tee',name:'Branch Tee',category:'T-shirts',badge:'',model:'6aa835e2c492123c6000fc1a',design:'102044',slug:'bird-on-branch-tshirt-colorful-minimalist-songbird-tee',camera:'front-2',colors:[['White','18542'],['Natural','18390'],['Athletic Heather','18078'],['Navy','18398'],['Black','18102']],sizes:['XS','S','M','L','XL','2XL','3XL','4XL','5XL'],description:'A soft, breathable tee featuring a small colorful bird over the heart.'},
  {id:'bird-sticker',name:'Songbird Sticker',category:'Accessories',badge:'',model:'6aa835e1d77e10b4e00e2899',design:'16655',slug:'colorful-bird-kiss-cut-sticker-cute-tropical-songbird-laptop-decal',camera:'front',primary:'45750',colors:[],sizes:['2” × 2”','3” × 3”','4” × 4”','6” × 6”'],description:'A glossy, colorful songbird sticker for laptops, journals, and other smooth surfaces.'},
  {id:'vintage-swallow',name:'Vintage Swallow Tee',category:'T-shirts',badge:'New',model:'6aa82814534b45b40e00300e',design:'108041',slug:'vintage-swallow-bird-tee-short-sleeve-shirt',camera:'front',colors:[['White','83039'],['Sand','91227'],['Silver','83035'],['Vegas Gold','91219'],['Grey Concrete','83489'],['Carolina Blue','83025'],['Atomic Blue','83023'],['Coyote Brown','96271'],['Olive Drab Green','96279'],['Iron Grey','83027'],['Woodland Brown','96287']],sizes:['XS','S','M','L','XL','2XL','3XL','4XL'],description:'A lightweight tee with a softly sketched swallow and a relaxed, everyday feel.'},
  {id:'perch-pine',name:'Perch & Pine Tee',category:'T-shirts',badge:'',model:'6aa8161a82b5d4441d034982',design:'98445',slug:'perch-pine-signature-bird-t-shirt-s-4xl',camera:'front',colors:[['White','73207'],['Ivory','78993'],['Khaki','78998'],['Bay','78878'],['Light Green','79008'],['Navy','73205'],['Espresso','102354']],sizes:['S','M','L','XL','2XL','3XL','4XL'],description:'A relaxed, garment-dyed everyday tee with a subtle signature bird graphic.'}
];
const colorHex={'White':'#f7f4ed','Light Pink':'#e5b5b5','Sand':'#c6b9a8','Light Blue':'#8ca4b5','Carolina Blue':'#6f94ae','Indigo Blue':'#4c6685','Royal':'#2e5aa0','Dark Heather':'#51565d','Navy':'#304961','Charcoal':'#3b3e42','Black':'#242833','Sport Grey':'#a9a9a6','Natural':'#efe7d2','Athletic Heather':'#aaa9a2','Silver':'#b8b8b8','Vegas Gold':'#d5b35a','Grey Concrete':'#9d9b95','Atomic Blue':'#4a7fa4','Coyote Brown':'#8a6e55','Olive Drab Green':'#66705a','Iron Grey':'#55595b','Woodland Brown':'#6e5347','Ivory':'#f3ede1','Khaki':'#b4a88f','Bay':'#718a83','Light Green':'#6c8570','Espresso':'#4a382d'};
const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));
    const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Mockups are self-hosted in /images/store/, one file per product and colour.
const photo=(p,color)=>`/images/store/${p.id}-${color?.[1]||p.primary||p.colors[0]?.[1]}.webp`;
// Colour dots get their colour through the style property, which the page's CSP allows (inline style attributes are not).
const paint=root=>root.querySelectorAll('[data-hex]').forEach(el=>{el.style.background=el.dataset.hex});
const byId=id=>products.find(p=>p.id===id);
const ICON_HEART='<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>';
const bag=[], saved=new Set();
let filter='All', sort='featured', active=null, activeColor=null, activeSize=null;

function dots(p){
  if(!p.colors.length) return '<span class="dots"><small>One design</small></span>';
  const shown=p.colors.slice(0,5).map(([n])=>`<i class="dot" title="${esc(n)}" data-hex="${colorHex[n]||'#9b968d'}"></i>`).join('');
  const more=p.colors.length>5?`<small>+${p.colors.length-5}</small>`:'';
  return `<span class="dots" aria-label="${p.colors.length} colours">${shown}${more}</span>`;
}
function visible(){
  let list=products.filter(p=>filter==='All'||p.category===filter);
  const order=products.map(p=>p.id);
  if(sort==='name') list=[...list].sort((a,b)=>a.name.localeCompare(b.name));
  else if(sort==='new') list=[...list].sort((a,b)=>(b.badge==='New')-(a.badge==='New')||order.indexOf(a.id)-order.indexOf(b.id));
  return list;
}
function renderProducts(){
  const list=visible();
  $('#productCount').textContent=`${list.length} ${list.length===1?'product':'products'}`;
  $('#products').innerHTML=list.length?list.map((p,i)=>{
    const second=p.colors[1];
    return `<article class="card" data-product="${esc(p.id)}">
      <div class="card-figure">
        <button class="card-media" type="button" data-open="${esc(p.id)}" aria-label="Quick view ${esc(p.name)}">
          <img class="img-a" src="${esc(photo(p,p.colors[0]))}" alt="${esc(p.name)}" ${i<4?'fetchpriority="high"':'loading="lazy"'} decoding="async" width="600" height="800">
          ${second?`<img class="img-b" data-src="${esc(photo(p,second))}" alt="" decoding="async" width="600" height="800">`:''}
          <span class="quick" aria-hidden="true">Quick view +</span>
        </button>
        <button class="fav" type="button" data-fav="${esc(p.id)}" aria-pressed="${saved.has(p.id)}" aria-label="Save ${esc(p.name)}">${ICON_HEART}</button>
      </div>
      <div class="card-body">
        ${dots(p)}
        ${p.badge?`<span class="tag${p.badge==='Limited'?' tag--limited':''}">${esc(p.badge)}</span>`:''}
        <button class="card-name" type="button" data-open="${esc(p.id)}">${esc(p.name)}</button>
        <p class="card-colour">${p.colors[0]?esc(p.colors[0][0]):'One design'}</p>
      </div>
    </article>`}).join(''):'<p class="empty-note">Nothing in this category yet.</p>';
  paint($('#products'));
  $$('#products [data-open]').forEach(b=>b.addEventListener('click',()=>openProduct(b.dataset.open)));
  $$('#products [data-fav]').forEach(b=>b.addEventListener('click',()=>toggleSaved(b.dataset.fav,b)));
  $$('#products .card').forEach(card=>{
    const load=()=>{const img=card.querySelector('.img-b');if(img&&!img.src){img.addEventListener('load',()=>img.classList.add('is-ready'),{once:true});img.src=img.dataset.src}};
    card.addEventListener('pointerenter',load,{once:true});card.addEventListener('focusin',load,{once:true});
  });
}
function setFilter(value){
  filter=value;$$('.chip').forEach(c=>c.setAttribute('aria-pressed',String(c.dataset.filter===value)));renderProducts();
}
function toggleSaved(id,btn){
  const p=byId(id);if(saved.has(id))saved.delete(id);else saved.add(id);
  if(btn)btn.setAttribute('aria-pressed',String(saved.has(id)));
  const n=saved.size;$('#favCount').textContent=n;n?$('#favCount').removeAttribute('data-empty'):$('#favCount').setAttribute('data-empty','');
  $('#favOpen').setAttribute('aria-label',`Saved items, ${n}`);
  toast(saved.has(id)?`${p.name} saved to your example list.`:`${p.name} removed from your example list.`);
}
function openProduct(id){
  const p=byId(id);if(!p)return;active=p;activeColor=p.colors[0]||null;activeSize=p.sizes.length===1?p.sizes[0]:null;
  $('#detail').innerHTML=`<div class="qv">
    <div class="qv-media" id="qvMedia"><img id="detailImage" src="${esc(photo(p,activeColor))}" alt="${esc(p.name)}" decoding="async"></div>
    <div class="qv-info">
      <p class="kicker">CREATOR · Collection 001</p>
      <h2 id="detailName">${esc(p.name)}</h2>
      ${p.colors.length?`<p class="opt-label">Colour <span id="selectedColor">${esc(activeColor[0])}</span></p><div class="swatches" role="group" aria-label="Colour">${p.colors.map(c=>`<button class="swatch" type="button" data-color="${esc(c[0])}" aria-pressed="${c===activeColor}" aria-label="${esc(c[0])}" title="${esc(c[0])}"><i data-hex="${colorHex[c[0]]||'#9b968d'}"></i></button>`).join('')}</div>`:''}
      <p class="opt-label">Size <span id="selectedSize">${activeSize?esc(activeSize):'Choose a size'}</span></p>
      <div class="sizes" role="group" aria-label="Size">${p.sizes.map(s=>`<button class="size" type="button" data-size="${esc(s)}" aria-pressed="${s===activeSize}">${esc(s)}</button>`).join('')}</div>
      <button class="primary" id="addToBag" type="button">Add to bag</button>
      <p class="demo-note"><strong>Example storefront</strong>Checkout and purchases are not available.</p>
      <p class="qv-desc">${esc(p.description)}</p>
    </div></div>`;
  paint($('#detail'));
  $$('#detail .swatch').forEach(b=>b.addEventListener('click',()=>{
    activeColor=p.colors.find(c=>c[0]===b.dataset.color);$('#selectedColor').textContent=activeColor[0];
    paint($('#detail'));
  $$('#detail .swatch').forEach(s=>s.setAttribute('aria-pressed',String(s===b)));
    const img=$('#detailImage'),media=$('#qvMedia'),next=new Image();media.classList.add('is-loading');
    next.onload=next.onerror=()=>{img.src=next.src;media.classList.remove('is-loading')};next.src=photo(p,activeColor);
  }));
  $$('#detail .size').forEach(b=>b.addEventListener('click',()=>{activeSize=b.dataset.size;$('#selectedSize').textContent=activeSize;$$('#detail .size').forEach(s=>s.setAttribute('aria-pressed',String(s===b)))}));
  $('#addToBag').addEventListener('click',()=>{
    if(!activeSize){toast('Choose a size first.');return}
    const color=activeColor?activeColor[0]:'';const found=bag.find(i=>i.id===p.id&&i.color===color&&i.size===activeSize);
    if(found)found.qty++;else bag.push({id:p.id,color,size:activeSize,qty:1});
    renderBag();$('#productDialog').close();openBag();
  });
  $('#productDialog').showModal();
}
function openBag(){renderBag();$('#bagDialog').showModal()}
function renderBag(){
  const count=bag.reduce((n,i)=>n+i.qty,0);
  $('#bagCount').textContent=count;count?$('#bagCount').removeAttribute('data-empty'):$('#bagCount').setAttribute('data-empty','');
  $('#bagOpen').setAttribute('aria-label',`Open example bag, ${count} ${count===1?'item':'items'}`);
  $('#bagItems').innerHTML=bag.length?bag.map((i,n)=>{const p=byId(i.id);return `<div class="bag-row"><img src="${esc(photo(p,p.colors.find(c=>c[0]===i.color)))}" alt=""><div><strong>${esc(p.name)}</strong><small>${esc([i.color,i.size].filter(Boolean).join(' · '))}</small></div><div class="qty"><button type="button" data-qty="-1" data-index="${n}" aria-label="Remove one ${esc(p.name)}">−</button><span>${i.qty}</span><button type="button" data-qty="1" data-index="${n}" aria-label="Add one ${esc(p.name)}">+</button></div></div>`}).join(''):'<p class="bag-empty">Your example bag is empty.</p>';
  $('#bagTotal').innerHTML=bag.length?`<span>Items in your example bag</span><strong>${count}</strong>`:'';
  $$('#bagItems [data-qty]').forEach(b=>b.addEventListener('click',()=>{const i=bag[Number(b.dataset.index)];i.qty+=Number(b.dataset.qty);if(i.qty<1)bag.splice(Number(b.dataset.index),1);renderBag()}));
}
let toastTimer;
function toast(message){const el=$('#toast');const host=document.querySelector('dialog[open]')||document.body;if(el.parentNode!==host)host.appendChild(el);el.textContent=message;el.classList.add('is-on');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('is-on'),2800)}

const heroA=byId('crewneck'), heroB=byId('canvas-tote'), story=byId('bird-hoodie');
if(!$('#heroImageA').getAttribute('src'))$('#heroImageA').src=photo(heroA,heroA.colors.find(c=>c[0]==='Sand'));$('#heroLabelA').textContent=heroA.name;$('#heroOpenA').addEventListener('click',()=>openProduct(heroA.id));
$('#heroImageB').src=photo(heroB,heroB.colors[0]);$('#heroLabelB').textContent=heroB.name;
$('#heroOpenB').addEventListener('click',()=>openProduct(heroB.id));
$('#storyImage').src=photo(story,story.colors[0]);$('#storyOpen').addEventListener('click',()=>openProduct(story.id));
$$('.chip').forEach(c=>c.addEventListener('click',()=>setFilter(c.dataset.filter)));
$$('[data-filter-link]').forEach(b=>b.addEventListener('click',()=>{setFilter(b.dataset.filterLink);$('#shop').scrollIntoView()}));
$('#sortSelect').addEventListener('change',e=>{sort=e.target.value;renderProducts()});
$('#bagOpen').addEventListener('click',openBag);
$('#favOpen').addEventListener('click',()=>toast(saved.size?`${saved.size} saved in this example. Saved items aren’t stored.`:'Tap the heart on a piece to save it in this example.'));
$('#checkoutBtn').addEventListener('click',()=>toast('This is an example store. Checkout isn’t available.'));
$('#newsForm').addEventListener('submit',e=>{e.preventDefault();const v=$('#newsEmail').value.trim();$('#newsStatus').textContent=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)?'Thanks. This is an example store, so nothing was signed up or sent.':'Enter an email address to preview sign-up.'});
$$('[data-close]').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
$$('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d)d.close()}));
renderProducts();renderBag();
