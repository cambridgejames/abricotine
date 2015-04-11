
var mime = require('mime'),
    remote = require('remote'),
    fs = require('fs'),
    Menu = remote.require('menu'),
    BrowserWindow = remote.require('browser-window'),
    AbrDocument = loadComponent('AbrDocument'),
    Abricotine = loadComponent('Abricotine'),
    config =  loadComponent('config'),
    ParseRoutine =  loadComponent('ParseRoutine'),
    argv = remote.process.argv;

module.exports = function () {
    function getFileToOpen (argv) {
        function isTextFile (path) {
            try {
                var fileStat = fs.statSync(path);
                if (fileStat.isFile()) {
                    var mimetype = mime.lookup(path);
                    return (mimetype && mimetype.substr(0,4) === 'text');
                }
                return false;
            }
            catch(err) {
                console.log(err);
                return false;
            }
        }
        for (var i=0; i<argv.length; i++) {
            if (isTextFile(argv[i])) {
                return argv[i];
            }
        }
        return false;
    }
    function initUi (config) {
        if (config.autoHideMenuBar) {
            Abricotine.exec("autoHideMenuBar");
        }
        if (config.showBlocks) {
            Abricotine.exec("showBlocks");
        }
        if (config.showHiddenCharacters) {
            Abricotine.exec("showHiddenCharacters");
        }
    }
    function initMenu (config) {
        function preprocessTemplate (element) {
            function replaceAttributes (item) {
                if (item.command) {
                    item.click = (function (command) {
                        return function () { Abricotine.exec(command); };
                    })(item.command);
                    delete item.command;
                }
                if (item.checked && typeof item.checked === "string") {
                    item.checked = config[item.checked] || false;
                }
                if (item.submenu) {
                    preprocessTemplate(item.submenu);
                }
                return item;
            }
            if (element.constructor !== Array) {
                return;
            }
            for (var i=0; i<element.length; i++) {
                replaceAttributes(element[i]);
            }
            return element;
        }
        function createMenuFromJSON (jsonPath) {
            var menuTemplate = loadComponent(jsonPath, 'json'),
                preprocessedMenuTemplate = preprocessTemplate(menuTemplate),
                menu = Menu.buildFromTemplate(preprocessedMenuTemplate);
            return menu;
        }     
        /* Menu */
        var menu = createMenuFromJSON('menu');
        Menu.setApplicationMenu(menu);
        /* Context Menu */
        var contextMenu = createMenuFromJSON('contextMenu');
        document.addEventListener("contextmenu", function () {
            contextMenu.popup(BrowserWindow.getFocusedWindow());
        });
        /* Reference in Abricotine */
        Abricotine.menu = menu;
        Abricotine.contextMenu = contextMenu;
    }
    function initDragAndDrop () {
        document.body.ondragover = function () {
            return false;
        };
        document.body.ondragleave = document.body.ondragend = function () {
            return false;
        };
        document.body.ondrop = function (e) {
            e.preventDefault();
            var file = e.dataTransfer.files[0];
            if (file && file.path) {
                Abricotine.currentDocument().cmdOpen(file.path);
            }
            return false;
        };
    }
    function initCloseEvent () {
        window.onbeforeunload = function(e) {
            config.saveUserConfig(Abricotine.config);
            return Abricotine.currentDocument().cmdClose();
        };
    }
    if (!window) {
        console.error('window is not defined');
    }
    window.Abricotine = Abricotine;
    var fileToOpen = getFileToOpen(argv),
        fullConfig = config.getFullConfig(),
        abrDoc;
    initUi(fullConfig);
    initMenu(fullConfig);
    initDragAndDrop();
    initCloseEvent();
    Abricotine.config = fullConfig;
    abrDoc = new AbrDocument(fileToOpen);
    Abricotine.documents.push(abrDoc);
    
    var event = "cursorActivity"; // TODO: changes possible (plus léger)
    
    new ParseRoutine ({
        name: "livePreview",
        context: {
            re: /!\[([-a-zA-Z0-9@:%._\+~#=\.\/! ]*)\]\(([-a-zA-Z0-9@:%._\+~#=\.\/]+\.(jpg|jpeg|png|gif|svg))\)/gi
        },
        prepare: function (args) {
            var abrEditor = this.abrEditor,
                doc = abrEditor.cm.doc;
            this.context.cursor = {
                begin: doc.getCursor("from"),
                end: doc.getCursor("to")
            };
        },
        eachLine: function (args) {
            function lineIsSelected (lineNumber, cursor) { // FIXME: ne fonctionne pas en cas de sélection multiple (on peut l'interdire pour simplifier ?)
                return !(cursor.begin.line > lineNumber || cursor.end.line < lineNumber);
            }
            // TODO: prendre en compte ![Alt text](/path/to/img.jpg "Optional title")
            function replaceImg (doc, startPos, endPos, url, alt) {
                if (!url) {
                    return;
                }
                alt = alt || '';
                var from = startPos,
                    to = endPos,
                    element = $('<img>').attr('src', url).attr('alt', alt).error(function(){
                        $(this).attr('src', 'https://cdn2.iconfinder.com/data/icons/windows-8-metro-style/32/error.png'); // TODO: plutot utiliser une classe à styler
                    }).get(0);
                var textMarker = doc.markText(from, to, {
                    replacedWith: element,
                    clearOnEnter: false,
                    handleMouseEvents: true,
                    inclusiveLeft: true,
                    inclusiveRight: true
                });
                textMarker.on("beforeCursorEnter", function () {
                    if (!doc.somethingSelected()) { // Fix blink on selection
                        textMarker.clear();
                    }
                });              
            }
            var abrEditor = this.abrEditor,
                doc = abrEditor.cm.doc,
                line = args.line,
                lineNumber = args.lineNumber,
                selections = args.selections,
                re = this.context.re,
                cursor = this.context.cursor,
                str = line.text,
                match;
            if (lineIsSelected(lineNumber, cursor)){
                return;
            }
            var alt, url, startPos, endPos; // TODO: cleaner
            while ((match = re.exec(str)) !== null) { // TODO: transformer en fonction générique autoPreview() afin de pouvoir prévisulaiser d'autres choses (maths par exemple)
                alt = match[1];
                url = match[2];
                startPos = {
                    line: lineNumber,
                    ch: match.index
                };
                endPos = {
                    line: lineNumber,
                    ch: startPos.ch + match[0].length
                };
                if (doc.findMarks(startPos, endPos).length > 0) {
                    continue;
                }
                replaceImg(doc, startPos, endPos, url, alt);
            }
        }
    }).attachTo("cursorActivity", abrDoc.editor);
    
    // À coder dans l'objet Editor
    abrDoc.editor.cm.on("cursorActivity", function (cm, changeObj) {
        abrDoc.editor.execParseRoutines("cursorActivity");
    });
    // FIXME: c'est complexe les routines > réfléchir à quelque chose de plus simple (une boucle qui appelle des fonctions ?)
    
};