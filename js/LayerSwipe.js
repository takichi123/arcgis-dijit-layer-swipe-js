define([
    "dojo/Evented",
    "dojo/_base/declare",
    "dojo/_base/lang",
    "dojo/has",
    "esri/kernel",
    "dijit/_WidgetBase",
    "dijit/_OnDijitClickMixin",
    "dijit/_TemplatedMixin",
    "dojo/on",
    // load template
    "dojo/text!zesri/dijit/templates/LayerSwipe.html",
    "dojo/i18n!zesri/nls/jsapi",
    "dojo/dom-class",
    "dojo/dom-style",
    "dojo/dnd/move",
    "dojo/dnd/Mover",
    "dojo/sniff",
    "dojo/dom-geometry",
    "esri/geometry/Point",
    "esri/geometry/Extent",
    "dojo/dom-construct",
    "dojo/Deferred",
    "dojo/promise/all"
],
function (
    Evented,
    declare,
    lang,
    has, esriNS,
    _WidgetBase, _OnDijitClickMixin, _TemplatedMixin,
    on,
    dijitTemplate, i18n,
    domClass, domStyle,
    move,
    Mover,
    sniff,
    domGeom,
    Point, Extent,
    domConstruct,
    Deferred,
    all
) {
    // patch subclass Mover and patch onFirstMove so that the swipe handle 
    // doesn't jump when first moved
    // remove if Dojo fixes this:  https://bugs.dojotoolkit.org/ticket/15322
    // patchedMover is used three times in _setSwipeType
    // 
    // fix is in the default switch case:
    //      l = m.l;
    //      t = m.t;
    var patchedMover = declare([Mover], {
        onFirstMove: function(e){
            var s = this.node.style, l, t, h = this.host;
            switch(s.position){
                case "relative":
                case "absolute":
                    l = Math.round(parseFloat(s.left)) || 0;
                    t = Math.round(parseFloat(s.top)) || 0;
                    break;
                default:
                    s.position = "absolute";    // enforcing the absolute mode
                    var m = domGeom.getMarginBox(this.node);
                    l = m.l;
                    t = m.t;
                    break;
            }
            this.marginBox.l = l - this.marginBox.l;
            this.marginBox.t = t - this.marginBox.t;
            if(h && h.onFirstMove){
                h.onFirstMove(this, e);
            }

            // Disconnect touch.move that call this function
            this.events.shift().remove();
        }
    });

    var Widget = declare([_WidgetBase, _OnDijitClickMixin, _TemplatedMixin, Evented], {
        declaredClass: "esri.dijit.LayerSwipe",
        templateString: dijitTemplate,
        options: {
            theme: "LayerSwipe",
            layers: [],
            enabled: true,
            type: "vertical",
            clip: 9
        },
        // lifecycle: 1
        constructor: function(options, srcRefNode) {
            // mix in settings and defaults
            declare.safeMixin(this.options, options);
            // widget node
            this.domNode = srcRefNode;
            this._i18n = i18n;
            // properties
            this.set("map", this.options.map);
            this.set("layers", this.options.layers);
            this.set("top", this.options.top);
            this.set("left", this.options.left);
            this.set("theme", this.options.theme);
            this.set("enabled", this.options.enabled);
            this.set("type", this.options.type);
            this.set("clip", this.options.clip);
            // listeners
            this.watch("theme", this._updateThemeWatch);
            this.watch("enabled", this._enabled);
            this.watch("type", this._type);
            // classes
            this._css = {
                handleContainer: "handleContainer",
                handle: "handle"
            };
            // event listeners array
            this._listeners = [];
        },
        // start widget. called by user
        startup: function() {
            // map not defined
            if (!this.map) {
                this.destroy();
                console.log('LayerSwipe::map required');
            }
            // set layers
            this.set("layers", this.layers);
            // no layers set
            if (!this.layers.length) {
                this.destroy();
                console.log('LayerSwipe::layer required');
            }
            // wait until all layers are loaded and map is loaded
            this._allLoaded().then(lang.hitch(this, function(){
                this._init();
            }));
        },
        // connections/subscriptions will be cleaned up during the destroy() lifecycle phase
        destroy: function() {
            this._removeEvents();
            this.inherited(arguments);
        },
        swipe: function(){
            this._setClipValue();
            this._swipe();  
        },
        /* ---------------- */
        /* Public Events */
        /* ---------------- */
        // load
        // swipe
        /* ---------------- */
        /* Public Functions */
        /* ---------------- */
        enable: function() {
            this.set("enabled", true);
        },
        disable: function() {
            this.set("enabled", false);
        },
        /* ---------------- */
        /* Private Functions */
        /* ---------------- */
        _allLoaded: function(){
            var loadPromises = [];
            // all layers
            for (var i = 0; i < this.layers.length; i++) {
                // if layers are set by ID string
                if (typeof this.layers[i] === 'string') {
                    // get layer
                    this.layers[i] = this.map.getLayer(this.layers[i]);
                }
                // layer deferred
                var def = new Deferred();
                // if layer isn't loaded
                if(!this.layers[i].loaded){
                    this._layerLoadedPromise(i, def);
                }
                else{
                    def.resolve('layer loaded');
                }
                loadPromises.push(def.promise);
            }
            var mapLoadDef = new Deferred();
            // if map is not loaded
            if (!this.map.loaded) {
                // when map is loaded
                on.once(this.map, "load", lang.hitch(this, function() {
                    mapLoadDef.resolve('map loaded');
                }));
            }
            else{
                mapLoadDef.resolve('map loaded');
            }
            loadPromises.push(mapLoadDef.promise);
            return all(loadPromises);
        },
        _layerLoadedPromise: function(i, def){
            on.once(this.layers[i], 'load', function(){
                def.resolve('layer loaded');
            });
        },
        _mb: function() {
            // set containing coordinates for scope type
            var mapBox = domGeom.getMarginBox(this.map.root);
            var b = {};
            b.t = 0;
            b.l = 0;
            b.w = mapBox.l + mapBox.w;
            b.h = mapBox.h + mapBox.t;
            return b;
        },
        _setSwipeType: function() {
            // set the type
            var moveBox, left, top;
            if (this.get("type")) {
                if (this._swipeslider) {
                    this._swipeslider.destroy();
                }
                domClass.add(this._moveableNode, this.get("type"));
                moveBox = domGeom.getMarginBox(this._moveableNode);
                if (this.get("type") === "scope") {
                    this._swipeslider = new move.constrainedMoveable(this._moveableNode, {
                        handle: this._moveableNode.id,
                        constraints: lang.hitch(this, this._mb),
                        within: true,
                        mover: patchedMover
                    });
                    // set initial position
                    left = (this.map.width / 2) - (moveBox.w / 2);
                    top = (this.map.height / 2) - (moveBox.h / 2);
                    if (typeof this.get("top") !== 'undefined') {
                        top = this.get("top");
                    }
                    if (typeof this.get("left") !== 'undefined') {
                        left = this.get("left");
                    }
                } else if (this.get("type") === "horizontal") {
                    // create movable
                    this._swipeslider = new move.parentConstrainedMoveable(this._moveableNode, {
                        area: "content",
                        within: true,
                        mover: patchedMover
                    });
                    // set initial position
                    left = 0;
                    top = (this.map.height / 4) - (moveBox.h / 2);
                    if (typeof this.get("top") !== 'undefined') {
                        top = this.get("top");
                    }
                    // set clip var
                    this._clipval = top;
                } else {
                    // create movable
                    this._swipeslider = new move.parentConstrainedMoveable(this._moveableNode, {
                        area: "content",
                        within: true,
                        mover: patchedMover
                    });
                    // set initial position
                    left = (this.map.width / 4) - (moveBox.w / 2);
                    top = 0;
                    if (typeof this.get("left") !== 'undefined') {
                        left = this.get("left");
                    }
                    // set clip var
                    this._clipval = left;
                }
                domStyle.set(this._moveableNode, {
                    top: top + "px",
                    left: left + "px"
                });
            }
        },
        _init: function() {
            // set type of swipe
            this._setSwipeType();
            // move domnode into map layers node
            domConstruct.place(this.domNode, this.map._layersDiv, 'last');
            // events
            this._setupEvents();
            // swipe it
            this.swipe();
            // we're ready
            this.set("loaded", true);
            this.emit("load", {});
        },
        _removeEvents: function() {
            if (this._listeners && this._listeners.length) {
                for (var i = 0; i < this._listeners.length; i++) {
                    if(this._listeners[i]){
                        this._listeners[i].remove();
                    }
                }
            }
            this._listeners = [];
        },
        _setClipValue: function() {
            var moveBox = domGeom.getMarginBox(this._moveableNode);
            if (this.get("type") === "vertical") {
                var leftInt = moveBox.l;
                if (leftInt <= 0) {
                    this._clipval = 0;
                }
                else if(leftInt >= this.map.width){
                    this._clipval = this.map.width;
                }
                else{
                    this._clipval = leftInt;
                }
            }
            else if (this.get("type") === "horizontal") {
                var topInt = moveBox.t;
                if (topInt <= 0) {
                    this._clipval = 0; 
                }
                else if(topInt >= this.map.height){
                    this._clipval = this.map.height; 
                }
                else{
                    this._clipval = topInt;   
                }
            }
        },
        _setupEvents: function() {
            this._removeEvents();
            // swipe move
            this._swipeMove = on.pausable(this._swipeslider, 'Move', lang.hitch(this, function() {
                this._setClipValue();
                this._swipe();
            }));
            this._listeners.push(this._swipeMove);
            // done panning
            this._swipePanEnd = on.pausable(this.map, 'pan-end', lang.hitch(this, function() {
                this._swipe();
            }));
            this._listeners.push(this._swipePanEnd);
            // map graphics have been updated
            this._mapUpdateEnd = on.pausable(this.map, 'update-end', lang.hitch(this, function() {
                this._swipe();
            }));
            this._listeners.push(this._mapUpdateEnd);
            // css panning
            if (this.map.navigationMode === "css-transforms") {
                this._swipePan = on.pausable(this.map, 'pan', lang.hitch(this, function() {
                    this._swipe();
                }));
                this._listeners.push(this._swipePan);
            }
            // scope has been clicked
            this._toolClick = on.pausable(this._moveableNode, 'click', lang.hitch(this, function(evt) {
                if(this.get("type") === "scope"){
                    if (this.map.hasOwnProperty('onClick') && typeof this.map.onClick === 'function' && this._clickCoords && this._clickCoords.x === evt.x && this._clickCoords.y === evt.y) {
                        var position = domGeom.position(this.map.root, true);
                        var x = evt.pageX - position.x;
                        var y = evt.pageY - position.y;
                        evt.x = x;
                        evt.y = y;
                        evt.screenPoint = {
                            x: x,
                            y: y
                        };
                        evt.type = "click";
                        evt.mapPoint = this.map.toMap(new Point(x, y, this.map.spatialReference));
                        this.map.onClick(evt, "other");
                    }
                    this._clickCoords = null;
                }
            }));
            this._listeners.push(this._toolClick);
            // scope mouse down click
            this._evtCoords = on.pausable(this._swipeslider, "MouseDown", lang.hitch(this, function(evt) {
                if(this.get("type") === "scope"){
                    this._clickCoords = {
                        x: evt.x,
                        y: evt.y
                    };
                }
            }));
            this._listeners.push(this._evtCoords);
        },
        _swipe: function() {
            var emitObj = {
                layers: []
            };
            if(this.layers && this.layers.length){
                // each layer
                for (var i = 0; i < this.layers.length; i++) {
                    // layer node div
                    var layerNode = this.layers[i]._div;
                    // position and extent variables
                    var rightval, leftval, topval, bottomval, layerBox, moveBox, mapBox, leftExtent;
                    // movable node position
                    moveBox = domGeom.getMarginBox(this._moveableNode);
                    // vertical and horizontal nodes
                    if(this.get("type") === "vertical" || this.get("type") === "horizontal"){
                        // if layer has a div
                        if(layerNode){
                            // get layer node position
                            layerBox = domGeom.getMarginBox(layerNode);
                        }
                        // map node position
                        mapBox = domGeom.getMarginBox(this.map.root);
                    }
                    if (this.get("type") === "vertical") {
                        if (layerBox && layerBox.l > 0) {
                            rightval = this._clipval - Math.abs(layerBox.l);
                            leftval = -(layerBox.l);
                        } else if (layerBox && layerBox.l < 0) {
                            leftval = 0;
                            rightval = this._clipval + Math.abs(layerBox.l);
                        } else {
                            leftval = 0;
                            rightval = this._clipval;
                        }
                        if (layerBox && layerBox.t > 0) {
                            topval = -(layerBox.t);
                            bottomval = mapBox.h - layerBox.t;
                        } else if (layerBox && layerBox.t < 0) {
                            topval = 0;
                            bottomval = mapBox.h + Math.abs(layerBox.t);
                        } else {
                            topval = 0;
                            bottomval = mapBox.h;
                        }
                    } else if (this.get("type") === "horizontal") {
                        if (layerBox && layerBox.t > 0) {
                            bottomval = this._clipval - Math.abs(layerBox.t);
                            topval = -(layerBox.t);
                        } else if (layerBox && layerBox.t < 0) {
                            topval = 0;
                            bottomval = this._clipval + Math.abs(layerBox.t);
                        } else {
                            topval = 0;
                            bottomval = this._clipval;
                        }
                        if (layerBox && layerBox.l > 0) {
                            leftval = -(layerBox.l);
                            rightval = mapBox.w - layerBox.l;
                        } else if (layerBox && layerBox.l < 0) {
                            leftval = 0;
                            rightval = mapBox.w + Math.abs(layerBox.l);
                        } else {
                            leftval = 0;
                            rightval = mapBox.w;
                        }
                    } else if (this.get("type") === "scope") {
                        leftval = moveBox.l;
                        rightval = leftval + moveBox.w;
                        topval = moveBox.t;
                        bottomval = topval + moveBox.h;
                        if (typeof this.get("clip") !== 'undefined') {
                            leftval += this.get("clip");
                            rightval += -this.get("clip");
                            topval += this.get("clip");
                            bottomval += -this.get("clip");
                        }
                    }
                    // graphics layer
                    if (this.layers[i].graphics) {
                        if(this.layers[i].graphics.length){
                            var ll, ur;
                            if (this.get("type") === "vertical") {
                                ll = this.map.toMap(new Point(0, this.map.height, this.map.spatialReference));
                                ur = this.map.toMap(new Point(this._clipval, 0, this.map.spatialReference));
                            } else if (this.get("type") === "horizontal") {
                                ll = this.map.toMap(new Point(0, this._clipval, this.map.spatialReference));
                                ur = this.map.toMap(new Point(this.map.width, 0, this.map.spatialReference));
                            } else if (this.get("type") === "scope") {
                                ll = this.map.toMap(new Point(leftval, bottomval, this.map.spatialReference));
                                ur = this.map.toMap(new Point(rightval, topval, this.map.spatialReference));
                            }
                            leftExtent = new Extent(ll.x, ll.y, ur.x, ur.y, this.map.spatialReference);
                            if (leftExtent) {
                                for (var k = 0; k < this.layers[i].graphics.length; k++) {
                                    var graphic = this.layers[i].graphics[k];
                                    var center = graphic.geometry.type === 'point' ? graphic.geometry : graphic.geometry.getExtent().getCenter();
                                    if (leftExtent.contains(center)) {
                                        graphic.show();
                                    } else {
                                        graphic.hide();
                                    }
                                }
                            }
                        }
                    // Non graphics layer
                    } else if (layerNode) {
                        // clip div
                        if (typeof rightval !== 'undefined' && typeof leftval !== 'undefined' && typeof topval !== 'undefined' && typeof bottomval !== 'undefined') {
                            // If CSS Transformation is applied to the layer (i.e. swipediv),
                            // record the amount of translation and adjust clip rect
                            // accordingly
                            var tx = 0,
                                ty = 0;
                            if (this.map.navigationMode === "css-transforms") {
                                var prefix = "";
                                if (sniff("webkit")) {
                                    prefix = "-webkit-";
                                }
                                if (sniff("ff")) {
                                    prefix = "-moz-";
                                }
                                if (sniff("ie")) {
                                    prefix = "-ms-";
                                }
                                if (sniff("opera")) {
                                    prefix = "-o-";
                                }
                                var divStyle = layerNode.style;
                                if(divStyle){
                                    var transformValue = divStyle.getPropertyValue(prefix + "transform");
                                    if (transformValue) {
                                        if (transformValue.toLowerCase().indexOf("translate3d") !== -1) {
                                            transformValue = transformValue.replace("translate3d(", "").replace(")", "").replace(/px/ig, "").replace(/\s/i, "").split(",");
                                        } else if (transformValue.toLowerCase().indexOf("translate") !== -1) {
                                            transformValue = transformValue.replace("translate(", "").replace(")", "").replace(/px/ig, "").replace(/\s/i, "").split(",");
                                        }
                                        try {
                                            tx = parseFloat(transformValue[0]);
                                            ty = parseFloat(transformValue[1]);
                                        } catch (e) {
                                            console.error(e);
                                        }
                                        leftval -= tx;
                                        rightval -= tx;
                                        topval -= ty;
                                        bottomval -= ty;
                                    }
                                }
                                //Syntax for clip "rect(top,right,bottom,left)"
                                //var clipstring = "rect(0px " + val + "px " + map.height + "px " + " 0px)";
                                var clipstring = "rect(" + topval + "px " + rightval + "px " + bottomval + "px " + leftval + "px)";
                                domStyle.set(layerNode, "clip", clipstring);   
                            }
                        }
                    }
                    var layerEmit = {
                        layer: this.layers[i],
                        left: leftval,
                        right: rightval,
                        top: topval,
                        bottom: bottomval,
                        extent: leftExtent
                    };
                    emitObj.layers.push(layerEmit);
                }
            }
            this.emit("swipe", emitObj);
        },
        _updateThemeWatch: function(attr, oldVal, newVal) {
            domClass.remove(this.domNode, oldVal);
            domClass.add(this.domNode, newVal);
        },
        _type: function(attr, oldVal, newVal) {
            // remove old css class
            if (oldVal) {
                domClass.remove(this._moveableNode, oldVal);
            }
            // set type of swipe type
            this._setSwipeType();
            // swipe it
            this._enabled();
        },
        _enabled: function() {
            if (this.get("enabled")) {
                // widget enabled
                domStyle.set(this.domNode, 'display', 'block');
                this._swipeMove.resume();
                this._swipePanEnd.resume();
                this._evtCoords.resume();
                this._toolClick.resume();
                this._mapUpdateEnd.resume();
                if (this._swipePan) {
                    this._swipePan.resume();
                }
                this._setClipValue();
                this._swipe();
            } else {
                // widget disabled
                this._swipeMove.pause();
                this._swipePanEnd.pause();
                this._evtCoords.pause();
                this._toolClick.pause();
                this._mapUpdateEnd.pause();
                if (this._swipePan) {
                    this._swipePan.pause();
                }
                domStyle.set(this.domNode, 'display', 'none');
                // unclip layers
                for (var i = 0; i < this.layers.length; i++) {
                    var layerNode = this.layers[i]._div;
                    if (layerNode && !this.layers[i].graphics) {
                        var clipstring = sniff('ie') ? "rect(auto auto auto auto)" : "";
                        domStyle.set(layerNode, "clip", clipstring);
                    }
                }
            }
        }
    });
    if (has("extend-esri")) {
        lang.setObject("dijit.LayerSwipe", Widget, esriNS);
    }
    return Widget;
});