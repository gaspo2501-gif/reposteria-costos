(function(){
  "use strict";

  var COLLECTIONS = ["ingredients","recipes","orders"];
  var state = {
    ingredients: [],
    recipes: [],
    orders: [],
    settings: { laborRatePerHour: 0, monthlyFixedCosts: 0, cakesPerMonth: 1 },
    tab: "recetas",
    dbMode: null // true = db capability, false = localStorage
  };

  // ---------- storage layer ----------
  var db = null;
  var LS_KEY = "reposteria_costos_v1";

  function lsLoad(){
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch(e){ return null; }
  }
  function lsSave(){
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        ingredients: state.ingredients,
        recipes: state.recipes,
        orders: state.orders,
        settings: state.settings
      }));
    } catch(e){}
  }
  function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,8); }

  function setSyncStatus(text){
    var el = document.getElementById("syncStatus");
    if (el) el.textContent = text;
  }

  function init(){
    if (typeof firebase === "undefined" || typeof firebaseConfig === "undefined") {
      fallbackLocal();
      return;
    }
    try {
      firebase.initializeApp(firebaseConfig);
      db = firebase.firestore();
      firebase.auth().onAuthStateChanged(function(user){
        if (user && state.dbMode === null) {
          state.dbMode = true;
          setSyncStatus("Sincronizado con la nube \u2014 mismos datos en todos tus dispositivos.");
          subscribeAll();
        }
      });
      firebase.auth().signInAnonymously().catch(function(){
        setSyncStatus("No se pudo conectar con la nube. Revis\u00e1 la configuraci\u00f3n de Firebase (firebase-config.js) y que la autenticaci\u00f3n an\u00f3nima est\u00e9 activada.");
        fallbackLocal();
      });
      setTimeout(function(){
        if (state.dbMode === null) fallbackLocal();
      }, 8000);
    } catch(e){
      fallbackLocal();
    }
  }

  function fallbackLocal(){
    if (state.dbMode !== null) return;
    state.dbMode = false;
    var data = lsLoad();
    if (data) {
      state.ingredients = data.ingredients || [];
      state.recipes = data.recipes || [];
      state.orders = data.orders || [];
      state.settings = data.settings || state.settings;
    }
    setSyncStatus("Guardado solo en este dispositivo (modo local de prueba).");
    render();
  }

  function subscribeAll(){
    db.collection("ingredients").onSnapshot(function(snap){
      state.ingredients = snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
      render();
    }, function(){ });
    db.collection("recipes").onSnapshot(function(snap){
      state.recipes = snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
      render();
    }, function(){ });
    db.collection("orders").onSnapshot(function(snap){
      state.orders = snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
      render();
    }, function(){ });
    db.doc("settings/main").onSnapshot(function(snap){
      if (snap.exists) state.settings = Object.assign({}, state.settings, snap.data());
      render();
    }, function(){ });
  }

  // generic CRUD wrapper
  function addDoc(col, data){
    if (state.dbMode) {
      return db.collection(col).add(data);
    } else {
      var id = uid();
      var obj = Object.assign({id:id}, data);
      state[col].push(obj);
      lsSave(); render();
      return Promise.resolve({id:id});
    }
  }
  function setDoc(col, id, data){
    if (state.dbMode) {
      return db.collection(col).doc(id).set(data);
    } else {
      var arr = state[col];
      var idx = arr.findIndex(function(x){ return x.id === id; });
      var obj = Object.assign({id:id}, data);
      if (idx >= 0) arr[idx] = obj; else arr.push(obj);
      lsSave(); render();
      return Promise.resolve();
    }
  }
  function deleteDoc(col, id){
    if (state.dbMode) {
      return db.collection(col).doc(id).delete();
    } else {
      state[col] = state[col].filter(function(x){ return x.id !== id; });
      lsSave(); render();
      return Promise.resolve();
    }
  }
  function saveSettings(data){
    state.settings = Object.assign({}, state.settings, data);
    if (state.dbMode) {
      return db.doc("settings/main").set(state.settings);
    } else {
      lsSave(); render();
      return Promise.resolve();
    }
  }

  // ---------- calculations ----------
  function fmt(n){
    n = Math.round((n + Number.EPSILON) * 100) / 100;
    return "$" + n.toLocaleString("es-AR", {minimumFractionDigits:2, maximumFractionDigits:2});
  }

  function ingredientById(id){
    return state.ingredients.find(function(i){ return i.id === id; });
  }

  function recipeIngredientCost(recipe){
    var total = 0;
    (recipe.items || []).forEach(function(it){
      var ing = ingredientById(it.ingredientId);
      if (!ing) return;
      var pricePerGram = (Number(ing.pricePerKg) || 0) / 1000;
      total += pricePerGram * (Number(it.grams) || 0);
    });
    return total;
  }

  function recipeLaborCost(recipe){
    var rate = Number(state.settings.laborRatePerHour) || 0;
    var minutes = Number(recipe.laborMinutes) || 0;
    return (minutes/60) * rate;
  }

  function recipeFixedCost(recipe){
    var monthly = Number(state.settings.monthlyFixedCosts) || 0;
    var perMonth = Number(state.settings.cakesPerMonth) || 1;
    var perCake = perMonth > 0 ? monthly/perMonth : 0;
    var units = Number(recipe.yieldUnits) || 1;
    return perCake * units;
  }

  function recipeCostBreakdown(recipe){
    var ingredientCost = recipeIngredientCost(recipe);
    var laborCost = recipeLaborCost(recipe);
    var fixedCost = recipeFixedCost(recipe);
    var packagingCost = Number(recipe.packagingCost) || 0;
    var totalCost = ingredientCost + laborCost + fixedCost + packagingCost;
    var margin = Number(recipe.marginPercent) || 0;
    var suggestedPrice = totalCost * (1 + margin/100);
    var profit = suggestedPrice - totalCost;
    return { ingredientCost:ingredientCost, laborCost:laborCost, fixedCost:fixedCost, packagingCost:packagingCost, totalCost:totalCost, suggestedPrice:suggestedPrice, profit:profit, margin:margin };
  }

  // ---------- rendering ----------
  var TABS = [
    {id:"recetas", label:"Recetas"},
    {id:"ingredientes", label:"Ingredientes"},
    {id:"pedidos", label:"Pedidos"},
    {id:"informe", label:"Informe"},
    {id:"config", label:"Config"}
  ];

  function renderTabs(){
    var nav = document.getElementById("tabs");
    nav.innerHTML = "";
    TABS.forEach(function(t){
      var b = document.createElement("button");
      b.textContent = t.label;
      b.className = state.tab === t.id ? "active" : "";
      b.onclick = function(){ state.tab = t.id; render(); };
      nav.appendChild(b);
    });
  }

  function render(){
    renderTabs();
    var main = document.getElementById("main");
    main.innerHTML = "";
    if (state.tab === "ingredientes") main.appendChild(viewIngredientes());
    else if (state.tab === "recetas") main.appendChild(viewRecetas());
    else if (state.tab === "pedidos") main.appendChild(viewPedidos());
    else if (state.tab === "informe") main.appendChild(viewInforme());
    else if (state.tab === "config") main.appendChild(viewConfig());
  }

  function el(tag, attrs, children){
    var e = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function(k){
      if (k === "class") e.className = attrs[k];
      else if (k === "html") e.innerHTML = attrs[k];
      else if (k.indexOf("on") === 0) e[k] = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    (children||[]).forEach(function(c){ if (c) e.appendChild(c); });
    return e;
  }
  function text(tag, cls, content){
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    e.textContent = content;
    return e;
  }

  // ----- Ingredientes -----
  function viewIngredientes(){
    var wrap = document.createDocumentFragment ? el("div",{}) : null;
    var card = el("div",{class:"card"});
    card.appendChild(text("h3","", "Nuevo ingrediente"));
    var form = el("form",{});
    var nameField = el("div",{class:"field"});
    nameField.appendChild(text("label","","Nombre"));
    var nameInput = el("input",{type:"text", placeholder:"Harina 0000", required:"true"});
    nameField.appendChild(nameInput);
    var priceField = el("div",{class:"field"});
    priceField.appendChild(text("label","","Precio por kilo ($)"));
    var priceInput = el("input",{type:"number", step:"0.01", min:"0", placeholder:"1200", required:"true"});
    priceField.appendChild(priceInput);
    form.appendChild(nameField);
    form.appendChild(priceField);
    var addBtn = el("button",{class:"btn block", type:"submit"});
    addBtn.textContent = "Agregar ingrediente";
    form.appendChild(addBtn);
    form.onsubmit = function(ev){
      ev.preventDefault();
      var name = nameInput.value.trim();
      var price = parseFloat(priceInput.value);
      if (!name || isNaN(price) || price < 0) return;
      addDoc("ingredients", {name:name, pricePerKg:price});
      nameInput.value = ""; priceInput.value = "";
    };
    card.appendChild(form);

    var listCard = el("div",{class:"card"});
    listCard.appendChild(text("h3","", "Tus ingredientes (" + state.ingredients.length + ")"));
    if (state.ingredients.length === 0) {
      listCard.appendChild(text("div","empty","Todavía no cargaste ingredientes."));
    } else {
      state.ingredients.slice().sort(function(a,b){ return (a.name||"").localeCompare(b.name||""); }).forEach(function(ing){
        var row = el("div",{class:"list-item"});
        var left = el("div",{});
        left.appendChild(text("div","item-name", ing.name));
        left.appendChild(text("div","item-sub", fmt(ing.pricePerKg) + " / kg  \u00b7  " + fmt((ing.pricePerKg||0)/1000) + " / g"));
        row.appendChild(left);
        var del = el("button",{class:"icon-btn danger"});
        del.textContent = "Eliminar";
        del.onclick = function(){
          if (confirm("¿Eliminar " + ing.name + "?")) deleteDoc("ingredients", ing.id);
        };
        row.appendChild(del);
        listCard.appendChild(row);
      });
    }
    var frag = el("div",{});
    frag.appendChild(card);
    frag.appendChild(listCard);
    return frag;
  }

  // ----- Recetas -----
  var recipeDraft = null; // {id?, name, items:[{ingredientId,grams}], laborMinutes, packagingCost, marginPercent, yieldUnits}

  function newDraft(existing){
    return existing ? JSON.parse(JSON.stringify(existing)) : {
      name:"", items:[], laborMinutes:0, packagingCost:0, marginPercent:60, yieldUnits:1
    };
  }

  function viewRecetas(){
    var frag = el("div",{});
    if (state.ingredients.length === 0) {
      var warn = el("div",{class:"card"});
      warn.appendChild(text("div","item-sub","Primero cargá algunos ingredientes en la pestaña Ingredientes para poder armar una receta."));
      frag.appendChild(warn);
    }

    var card = el("div",{class:"card"});
    card.appendChild(text("h3","", recipeDraft && recipeDraft.id ? "Editar receta" : "Nueva receta"));
    var form = el("form",{});

    var nameField = el("div",{class:"field"});
    nameField.appendChild(text("label","","Nombre de la torta / producto"));
    var draft = recipeDraft || newDraft();
    var nameInput = el("input",{type:"text", placeholder:"Torta de chocolate 20cm", value:draft.name});
    nameField.appendChild(nameInput);
    form.appendChild(nameField);

    var itemsWrap = el("div",{class:"field"});
    itemsWrap.appendChild(text("label","","Ingredientes de la receta (en gramos)"));
    var itemsList = el("div",{});
    function renderItems(){
      itemsList.innerHTML = "";
      draft.items.forEach(function(it, idx){
        var row = el("div",{class:"ingredient-row"});
        var sel = el("select",{});
        var placeholder = el("option",{value:""}); placeholder.textContent = "Elegí ingrediente";
        sel.appendChild(placeholder);
        state.ingredients.forEach(function(ing){
          var opt = el("option",{value:ing.id});
          opt.textContent = ing.name;
          if (ing.id === it.ingredientId) opt.selected = true;
          sel.appendChild(opt);
        });
        sel.onchange = function(){ it.ingredientId = sel.value; };
        var gramsInput = el("input",{type:"number", min:"0", step:"1", placeholder:"gramos", value: it.grams || ""});
        gramsInput.oninput = function(){ it.grams = parseFloat(gramsInput.value) || 0; };
        var rm = el("button",{type:"button", class:"icon-btn danger"});
        rm.textContent = "✕";
        rm.onclick = function(){ draft.items.splice(idx,1); renderItems(); };
        row.appendChild(sel); row.appendChild(gramsInput); row.appendChild(rm);
        itemsList.appendChild(row);
      });
    }
    renderItems();
    itemsWrap.appendChild(itemsList);
    var addItemBtn = el("button",{type:"button", class:"btn secondary"});
    addItemBtn.textContent = "+ agregar ingrediente";
    addItemBtn.onclick = function(){ draft.items.push({ingredientId:"", grams:0}); renderItems(); };
    itemsWrap.appendChild(addItemBtn);
    form.appendChild(itemsWrap);

    var grid = el("div",{class:"grid2"});
    var laborField = el("div",{class:"field"});
    laborField.appendChild(text("label","","Tiempo de trabajo (minutos)"));
    var laborInput = el("input",{type:"number", min:"0", step:"1", value: draft.laborMinutes || 0});
    laborInput.oninput = function(){ draft.laborMinutes = parseFloat(laborInput.value) || 0; };
    laborField.appendChild(laborInput);

    var packField = el("div",{class:"field"});
    packField.appendChild(text("label","","Empaque / insumos ($)"));
    var packInput = el("input",{type:"number", min:"0", step:"0.01", value: draft.packagingCost || 0});
    packInput.oninput = function(){ draft.packagingCost = parseFloat(packInput.value) || 0; };
    packField.appendChild(packInput);

    var marginField = el("div",{class:"field"});
    marginField.appendChild(text("label","","Margen de ganancia (%)"));
    var marginInput = el("input",{type:"number", min:"0", step:"1", value: draft.marginPercent != null ? draft.marginPercent : 60});
    marginInput.oninput = function(){ draft.marginPercent = parseFloat(marginInput.value) || 0; renderPreview(); };
    marginField.appendChild(marginInput);

    var yieldField = el("div",{class:"field"});
    yieldField.appendChild(text("label","","Unidades que produce esta receta"));
    var yieldInput = el("input",{type:"number", min:"1", step:"1", value: draft.yieldUnits || 1});
    yieldInput.oninput = function(){ draft.yieldUnits = parseFloat(yieldInput.value) || 1; renderPreview(); };
    yieldField.appendChild(yieldInput);

    grid.appendChild(laborField); grid.appendChild(packField);
    grid.appendChild(marginField); grid.appendChild(yieldField);
    form.appendChild(grid);

    var previewCard = el("div",{class:"stat", style:""});
    previewCard.style.marginBottom = "10px";
    function renderPreview(){
      previewCard.innerHTML = "";
      var b = recipeCostBreakdown(draft);
      previewCard.appendChild(el("div",{class:"row"},[ text("span","label","Costo total estimado"), text("span","value", fmt(b.totalCost)) ]));
      var priceRow = el("div",{class:"row"});
      priceRow.style.marginTop = "8px";
      priceRow.appendChild(text("span","label","Precio de venta sugerido"));
      priceRow.appendChild(text("span","value", fmt(b.suggestedPrice)));
      previewCard.appendChild(priceRow);
      var profitRow = el("div",{class:"row"});
      profitRow.style.marginTop = "4px";
      profitRow.appendChild(text("span","item-sub","Ganancia estimada"));
      profitRow.appendChild(text("span","item-sub", fmt(b.profit)));
      previewCard.appendChild(profitRow);
    }
    // recompute preview on every ingredient/grams change too
    itemsList.addEventListener("input", renderPreview);
    itemsList.addEventListener("change", renderPreview);
    laborInput.addEventListener("input", renderPreview);
    packInput.addEventListener("input", renderPreview);
    renderPreview();
    form.appendChild(previewCard);

    var saveBtn = el("button",{type:"submit", class:"btn block"});
    saveBtn.textContent = draft.id ? "Guardar cambios" : "Guardar receta";
    form.appendChild(saveBtn);
    if (draft.id) {
      var cancelBtn = el("button",{type:"button", class:"btn secondary block"});
      cancelBtn.style.marginTop = "8px";
      cancelBtn.textContent = "Cancelar edición";
      cancelBtn.onclick = function(){ recipeDraft = null; render(); };
      form.appendChild(cancelBtn);
    }

    form.onsubmit = function(ev){
      ev.preventDefault();
      var name = nameInput.value.trim();
      if (!name) return;
      var validItems = draft.items.filter(function(it){ return it.ingredientId && it.grams > 0; });
      var payload = {
        name:name, items:validItems, laborMinutes:draft.laborMinutes||0,
        packagingCost:draft.packagingCost||0, marginPercent:draft.marginPercent||0,
        yieldUnits:draft.yieldUnits||1
      };
      if (draft.id) {
        setDoc("recipes", draft.id, payload);
      } else {
        addDoc("recipes", payload);
      }
      recipeDraft = null;
      render();
    };

    card.appendChild(form);
    frag.appendChild(card);

    var listCard = el("div",{class:"card"});
    listCard.appendChild(text("h3","", "Tus recetas (" + state.recipes.length + ")"));
    if (state.recipes.length === 0) {
      listCard.appendChild(text("div","empty","Todavía no armaste ninguna receta."));
    } else {
      state.recipes.forEach(function(r){
        var b = recipeCostBreakdown(r);
        var row = el("div",{class:"list-item"});
        var left = el("div",{});
        left.appendChild(text("div","item-name", r.name));
        left.appendChild(text("div","item-sub", "Costo " + fmt(b.totalCost) + "  \u00b7  Venta sugerida " + fmt(b.suggestedPrice)));
        row.appendChild(left);
        var actions = el("div",{});
        actions.style.display = "flex";
        var editBtn = el("button",{class:"icon-btn"}); editBtn.textContent = "Editar";
        editBtn.onclick = function(){ recipeDraft = newDraft(r); render(); window.scrollTo({top:0, behavior:"smooth"}); };
        var delBtn = el("button",{class:"icon-btn danger"}); delBtn.textContent = "Eliminar";
        delBtn.onclick = function(){ if (confirm("¿Eliminar receta \"" + r.name + "\"?")) deleteDoc("recipes", r.id); };
        actions.appendChild(editBtn); actions.appendChild(delBtn);
        row.appendChild(actions);
        listCard.appendChild(row);
      });
    }
    frag.appendChild(listCard);
    return frag;
  }

  // ----- Pedidos -----
  function viewPedidos(){
    var frag = el("div",{});
    var card = el("div",{class:"card"});
    card.appendChild(text("h3","", "Nuevo pedido"));
    if (state.recipes.length === 0) {
      card.appendChild(text("div","item-sub","Primero creá al menos una receta para poder registrar pedidos."));
      frag.appendChild(card);
      return frag;
    }
    var form = el("form",{});
    var recipeField = el("div",{class:"field"});
    recipeField.appendChild(text("label","","Producto"));
    var recipeSel = el("select",{});
    state.recipes.forEach(function(r){
      var opt = el("option",{value:r.id}); opt.textContent = r.name; recipeSel.appendChild(opt);
    });
    recipeField.appendChild(recipeSel);
    form.appendChild(recipeField);

    var grid = el("div",{class:"grid2"});
    var qtyField = el("div",{class:"field"});
    qtyField.appendChild(text("label","","Cantidad"));
    var qtyInput = el("input",{type:"number", min:"1", step:"1", value:"1"});
    qtyField.appendChild(qtyInput);
    var priceField = el("div",{class:"field"});
    priceField.appendChild(text("label","","Precio cobrado (total, $)"));
    var priceInput = el("input",{type:"number", min:"0", step:"0.01", placeholder:"0.00"});
    priceField.appendChild(priceInput);
    grid.appendChild(qtyField); grid.appendChild(priceField);
    form.appendChild(grid);

    var dateField = el("div",{class:"field"});
    dateField.appendChild(text("label","","Fecha"));
    var dateInput = el("input",{type:"date", value:new Date().toISOString().slice(0,10)});
    dateField.appendChild(dateInput);
    form.appendChild(dateField);

    function fillSuggestedPrice(){
      var r = state.recipes.find(function(x){ return x.id === recipeSel.value; });
      if (!r) return;
      var b = recipeCostBreakdown(r);
      var qty = parseFloat(qtyInput.value) || 1;
      priceInput.placeholder = fmt(b.suggestedPrice * qty);
    }
    recipeSel.onchange = fillSuggestedPrice;
    qtyInput.oninput = fillSuggestedPrice;
    fillSuggestedPrice();

    var saveBtn = el("button",{type:"submit", class:"btn block"});
    saveBtn.textContent = "Registrar pedido";
    form.appendChild(saveBtn);

    form.onsubmit = function(ev){
      ev.preventDefault();
      var r = state.recipes.find(function(x){ return x.id === recipeSel.value; });
      if (!r) return;
      var qty = parseFloat(qtyInput.value) || 1;
      var b = recipeCostBreakdown(r);
      var price = parseFloat(priceInput.value);
      if (isNaN(price)) price = b.suggestedPrice * qty;
      addDoc("orders", {
        recipeId:r.id, recipeName:r.name, quantity:qty,
        costPerUnit:b.totalCost, sellPrice:price,
        date:dateInput.value, delivered:false, paid:false
      });
      qtyInput.value = "1"; priceInput.value = "";
    };
    card.appendChild(form);
    frag.appendChild(card);

    var listCard = el("div",{class:"card"});
    listCard.appendChild(text("h3","", "Pedidos registrados (" + state.orders.length + ")"));
    if (state.orders.length === 0) {
      listCard.appendChild(text("div","empty","Todavía no registraste pedidos."));
    } else {
      state.orders.slice().sort(function(a,b){ return (b.date||"").localeCompare(a.date||""); }).forEach(function(o){
        var row = el("div",{class:"list-item"});
        row.style.flexDirection = "column";
        row.style.alignItems = "stretch";
        var top = el("div",{class:"row"});
        var left = el("div",{});
        left.appendChild(text("div","item-name", o.recipeName + " \u00d7 " + o.quantity));
        left.appendChild(text("div","item-sub", (o.date || "") + "  \u00b7  Cobrado " + fmt(o.sellPrice)));
        top.appendChild(left);
        var delBtn = el("button",{class:"icon-btn danger"}); delBtn.textContent = "Eliminar";
        delBtn.onclick = function(){ if (confirm("¿Eliminar este pedido?")) deleteDoc("orders", o.id); };
        top.appendChild(delBtn);
        row.appendChild(top);

        var pills = el("div",{class:"status-pill"});
        pills.style.marginTop = "8px";
        var deliveredBtn = el("button",{type:"button"});
        deliveredBtn.className = o.delivered ? "on delivered" : "";
        deliveredBtn.textContent = o.delivered ? "✓ Entregado" : "Marcar entregado";
        deliveredBtn.onclick = function(){ setDoc("orders", o.id, Object.assign({}, o, {delivered: !o.delivered})); };
        var paidBtn = el("button",{type:"button"});
        paidBtn.className = o.paid ? "on paid" : "";
        paidBtn.textContent = o.paid ? "✓ Cobrado" : "Marcar cobrado";
        paidBtn.onclick = function(){ setDoc("orders", o.id, Object.assign({}, o, {paid: !o.paid})); };
        pills.appendChild(deliveredBtn); pills.appendChild(paidBtn);
        row.appendChild(pills);
        listCard.appendChild(row);
      });
    }
    frag.appendChild(listCard);
    return frag;
  }

  // ----- Informe -----
  function viewInforme(){
    var frag = el("div",{});
    var delivered = state.orders.filter(function(o){ return o.delivered; });
    var paid = state.orders.filter(function(o){ return o.paid; });
    var totalRevenue = paid.reduce(function(s,o){ return s + (Number(o.sellPrice)||0); }, 0);
    var totalCost = state.orders.reduce(function(s,o){ return s + (Number(o.costPerUnit)||0) * (Number(o.quantity)||1); }, 0);
    var totalCostPaid = paid.reduce(function(s,o){ return s + (Number(o.costPerUnit)||0) * (Number(o.quantity)||1); }, 0);
    var profit = totalRevenue - totalCostPaid;
    var pendingPayment = state.orders.filter(function(o){ return o.delivered && !o.paid; });

    var summary = el("div",{class:"card"});
    summary.appendChild(text("h3","", "Resumen general"));
    var grid = el("div",{class:"grid2"});
    grid.appendChild(statBox("Pedidos totales", state.orders.length));
    grid.appendChild(statBox("Entregados", delivered.length));
    grid.appendChild(statBox("Cobrado", fmt(totalRevenue)));
    grid.appendChild(statBox("Ganancia (cobrados)", fmt(profit)));
    summary.appendChild(grid);
    frag.appendChild(summary);

    if (pendingPayment.length > 0) {
      var pend = el("div",{class:"card"});
      pend.appendChild(text("h3","", "Entregados y pendientes de cobro (" + pendingPayment.length + ")"));
      pendingPayment.forEach(function(o){
        var row = el("div",{class:"list-item"});
        row.appendChild(text("div","item-name", o.recipeName + " \u00d7 " + o.quantity));
        row.appendChild(text("div","item-sub", fmt(o.sellPrice)));
        pend.appendChild(row);
      });
      frag.appendChild(pend);
    }

    var byProduct = {};
    state.orders.forEach(function(o){
      if (!byProduct[o.recipeName]) byProduct[o.recipeName] = {qty:0, revenue:0, cost:0};
      byProduct[o.recipeName].qty += Number(o.quantity)||0;
      if (o.paid) byProduct[o.recipeName].revenue += Number(o.sellPrice)||0;
      byProduct[o.recipeName].cost += (Number(o.costPerUnit)||0) * (Number(o.quantity)||1);
    });
    var prodCard = el("div",{class:"card"});
    prodCard.appendChild(text("h3","", "Por producto"));
    var keys = Object.keys(byProduct);
    if (keys.length === 0) {
      prodCard.appendChild(text("div","empty","Todavía no hay pedidos para mostrar."));
    } else {
      keys.forEach(function(name){
        var d = byProduct[name];
        var row = el("div",{class:"list-item"});
        var left = el("div",{});
        left.appendChild(text("div","item-name", name + " \u00d7 " + d.qty));
        left.appendChild(text("div","item-sub", "Costo total " + fmt(d.cost)));
        row.appendChild(left);
        row.appendChild(text("div","item-sub", "Cobrado " + fmt(d.revenue)));
        prodCard.appendChild(row);
      });
    }
    frag.appendChild(prodCard);
    return frag;
  }
  function statBox(label, value){
    var s = el("div",{class:"stat"});
    s.appendChild(text("div","label", label));
    s.appendChild(text("div","value", String(value)));
    return s;
  }

  // ----- Config -----
  function viewConfig(){
    var frag = el("div",{});
    var card = el("div",{class:"card"});
    card.appendChild(text("h3","", "Costos generales del negocio"));
    var form = el("form",{});

    var laborField = el("div",{class:"field"});
    laborField.appendChild(text("label","","Valor de tu hora de trabajo ($)"));
    var laborInput = el("input",{type:"number", min:"0", step:"1", value: state.settings.laborRatePerHour || 0});
    laborField.appendChild(laborInput);
    form.appendChild(laborField);

    var fixedField = el("div",{class:"field"});
    fixedField.appendChild(text("label","","Gastos fijos mensuales — luz, gas, alquiler ($)"));
    var fixedInput = el("input",{type:"number", min:"0", step:"1", value: state.settings.monthlyFixedCosts || 0});
    fixedField.appendChild(fixedInput);
    form.appendChild(fixedField);

    var cakesField = el("div",{class:"field"});
    cakesField.appendChild(text("label","","Tortas / unidades que hacés por mes aprox."));
    var cakesInput = el("input",{type:"number", min:"1", step:"1", value: state.settings.cakesPerMonth || 1});
    cakesField.appendChild(cakesInput);
    form.appendChild(cakesField);

    frag_note();
    function frag_note(){
      var note = text("div","item-sub","Con esto calculamos cuánto gasto fijo le corresponde a cada torta.");
      note.style.marginBottom = "10px";
      form.appendChild(note);
    }

    var saveBtn = el("button",{type:"submit", class:"btn block"});
    saveBtn.textContent = "Guardar configuración";
    form.appendChild(saveBtn);
    form.onsubmit = function(ev){
      ev.preventDefault();
      saveSettings({
        laborRatePerHour: parseFloat(laborInput.value) || 0,
        monthlyFixedCosts: parseFloat(fixedInput.value) || 0,
        cakesPerMonth: parseFloat(cakesInput.value) || 1
      });
    };
    card.appendChild(form);
    frag.appendChild(card);

    var infoCard = el("div",{class:"card"});
    infoCard.appendChild(text("h3","", "Sobre esta prueba"));
    var p = document.createElement("div");
    p.className = "item-sub";
    p.innerHTML = "Esta es una versión de prueba de la app. Los datos se guardan " + (state.dbMode ? "en la nube de este prototipo y se sincronizan entre los dispositivos donde abras este mismo enlace." : "solo en este dispositivo/navegador.") ;
    infoCard.appendChild(p);
    frag.appendChild(infoCard);
    return frag;
  }

  init();
  render();
})();
