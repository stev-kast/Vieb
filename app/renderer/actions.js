/*
* Vieb - Vim Inspired Electron Browser
* Copyright (C) 2019-2022 Jelmer van Arnhem
*
* This program is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* (at your option) any later version.
*
* This program is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
* GNU General Public License for more details.
*
* You should have received a copy of the GNU General Public License
* along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/
"use strict"

const {ipcRenderer, clipboard} = require("electron")
const {
    urlToString,
    joinPath,
    appData,
    makeDir,
    writeFile,
    notify,
    watchFile,
    readFile,
    searchword,
    stringToUrl,
    sendToPageOrSubFrame,
    isFile,
    isDir
} = require("../util")
const {
    listTabs,
    listPages,
    currentTab,
    currentPage,
    tabOrPageMatching,
    currentMode,
    getSetting,
    getStored,
    updateGuiVisibility
} = require("./common")

let currentSearch = ""

const emptySearch = () => {
    listPages().filter(p => p).forEach(page => {
        try {
            page.stopFindInPage("clearSelection")
        } catch {
            // Page unavailable or suspended
        }
    })
    currentSearch = ""
}

const clickOnSearch = () => {
    if (currentSearch) {
        currentPage()?.send("search-element-click")
    }
}

const nextPage = () => sendToPageOrSubFrame("action", "nextPage")

const previousPage = () => sendToPageOrSubFrame("action", "previousPage")

const nextPageNewTab = () => sendToPageOrSubFrame("action", "nextPage", true)

const previousPageNewTab = () => sendToPageOrSubFrame(
    "action", "previousPage", true)

const increasePageNumber = () => movePageNumber(1)

const decreasePageNumber = () => movePageNumber(-1)

const movePageNumber = movement => modifyUrl("(\\?|&)p(age)?=(\\d+)",
    (_, p1, p2, p3) => {
        if (Number(p3) + movement < 1) {
            return `${p1}p${p2}=1`
        }
        return `${p1}p${p2}=${Number(p3) + movement}`
    })

const increasePortNumber = () => movePortNumber(1)

const decreasePortNumber = () => movePortNumber(-1)

const movePortNumber = movement => {
    const url = currentPage()?.src || ""
    const loc = document.createElement("a")
    loc.href = url
    let port = Number(loc.port)
    if (!port && loc.protocol === "http:") {
        port = 80
    }
    if (!port && loc.protocol === "https:") {
        port = 443
    }
    if (port) {
        modifyUrl("(^[a-zA-Z\\d]+:\\/\\/[.a-zA-Z\\d-]+)(:\\d+)?(.*$)",
            (_, domain, _port, rest) => {
                if (isNaN(port)) {
                    return `${domain}${rest}`
                }
                port += movement
                if (port <= 10) {
                    return `${domain}:11${rest}`
                }
                if (port > 65535) {
                    return `${domain}:65535${rest}`
                }
                return `${domain}:${port}${rest}`
            })
    }
}

const increaseFirstNumber = () => moveFirstNumber(1)

const decreaseFirstNumber = () => moveFirstNumber(-1)

const moveFirstNumber = movement => modifyUrl("\\d+", (_, match) => {
    if (Number(match) + movement < 1) {
        return "1"
    }
    return `${Number(match) + movement}`
})

const increaseLastNumber = () => moveLastNumber(1)

const decreaseLastNumber = () => moveLastNumber(-1)

const moveLastNumber = movement => modifyUrl("(\\d+)(\\D*$)", (_, p1, p2) => {
    if (Number(p1) + movement < 1) {
        return `1${p2}`
    }
    return `${Number(p1) + movement}${p2}`
})

const toParentUrl = () => modifyUrl("(^[a-z][a-zA-Z\\d]+:\\/?\\/?.*?\\/)"
    + "(.*\\/)?(.+?$)", (_, domain, path) => domain + (path || ""))

const toRootUrl = () => modifyUrl("(^[a-z][a-zA-Z\\d]+:\\/?\\/?.*?\\/)"
    + "(.*$)", (_, domain) => domain)

const toParentSubdomain = () => modifyUrl("(^[a-z][a-zA-Z\\d]+:\\/?\\/?)("
    + "www\\.)?([a-zA-Z\\d]*?\\.)((?:[a-zA-Z\\d]*?\\.)*)([a-zA-Z\\d]*?\\.[a-zA-"
    + "Z]+.*$)", (_, p, w, __, s, m) => p + (w || "") + (s || "") + (m || ""))

const toRootSubdomain = () => modifyUrl("(^[a-z][a-zA-Z\\d]+:\\/?\\/?)("
    + "www\\.)?([a-zA-Z\\d]*?\\.)((?:[a-zA-Z\\d]*?\\.)*)([a-zA-Z\\d]*?\\.[a-zA-"
    + "Z]+.*$)", (_, p, w, __, ___, m) => p + (w || "") + (m || ""))

const modifyUrl = (source, replacement) => {
    const url = currentPage()?.src || ""
    const next = url.replace(RegExp(source), replacement)
    if (next !== url) {
        const {navigateTo} = require("./tabs")
        navigateTo(next)
    }
}

const previousTab = () => {
    const {switchToTab} = require("./tabs")
    switchToTab(listTabs().indexOf(currentTab()) - 1)
}

const toggleSourceViewer = () => {
    const {navigateTo} = require("./tabs")
    if (currentPage().src.startsWith("sourceviewer:")) {
        const src = currentPage().src.replace(/^sourceviewer:\/?\/?/g, "")
        let loc = String(src)
        if (process.platform !== "win32" && !loc.startsWith("/")) {
            loc = `/${loc}`
        }
        if (isFile(loc) || isDir(loc)) {
            navigateTo(`file://${loc}`)
            return
        }
        navigateTo(`https://${src}`)
    } else {
        navigateTo(currentPage().src.replace(/^.+?:\/?\/?/g, "sourceviewer:"))
    }
}

const toggleSourceViewerNewTab = () => {
    const {navigateTo, addTab} = require("./tabs")
    if (currentPage().src.startsWith("sourceviewer:")) {
        const src = currentPage().src.replace(/^sourceviewer:\/?\/?/g, "")
        let loc = String(src)
        if (process.platform !== "win32" && !loc.startsWith("/")) {
            loc = `/${loc}`
        }
        if (isFile(loc) || isDir(loc)) {
            navigateTo(`file://${loc}`)
            return
        }
        navigateTo(`https://${src}`)
    } else {
        addTab({"url": currentPage().src.replace(
            /^.+?:\/?\/?/g, "sourceviewer:")})
    }
}

const toggleReaderView = () => {
    const {navigateTo} = require("./tabs")
    if (currentPage().src.startsWith("readerview:")) {
        const src = currentPage().src.replace(/^readerview:\/?\/?/g, "")
        let loc = String(src)
        if (process.platform !== "win32" && !loc.startsWith("/")) {
            loc = `/${loc}`
        }
        if (isFile(loc) || isDir(loc)) {
            navigateTo(`file://${loc}`)
            return
        }
        navigateTo(`https://${src}`)
    } else {
        navigateTo(currentPage().src.replace(/^.+?:\/?\/?/g, "readerview:"))
    }
}

const toggleReaderViewNewTab = () => {
    const {navigateTo, addTab} = require("./tabs")
    if (currentPage().src.startsWith("readerview:")) {
        const src = currentPage().src.replace(/^readerview:\/?\/?/g, "")
        let loc = String(src)
        if (process.platform !== "win32" && !loc.startsWith("/")) {
            loc = `/${loc}`
        }
        if (isFile(loc) || isDir(loc)) {
            navigateTo(`file://${loc}`)
            return
        }
        navigateTo(`https://${src}`)
    } else {
        addTab({"url": currentPage().src.replace(
            /^.+?:\/?\/?/g, "readerview:")})
    }
}

const toExploreMode = () => {
    const {setMode} = require("./modes")
    setMode("explore")
}

const insertAtFirstInput = () => sendToPageOrSubFrame("focus-input")

const toInsertMode = () => {
    const {setMode} = require("./modes")
    setMode("insert")
}

const scrollTop = () => currentPage()?.send("action", "scrollTop")

const scrollBottom = () => currentPage()?.send("action", "scrollBottom")

const scrollRightMax = () => currentPage()?.send("action", "scrollRightMax")

const scrollLeftMax = () => currentPage()?.send("action", "scrollLeftMax")

const scrollUp = () => currentPage()?.send("action", "scrollUp")

const scrollDown = () => currentPage()?.send("action", "scrollDown")

const scrollRight = () => currentPage()?.send("action", "scrollRight")

const scrollLeft = () => currentPage()?.send("action", "scrollLeft")

const scrollPageRight = () => currentPage()?.send("action", "scrollPageRight")

const scrollPageLeft = () => currentPage()?.send("action", "scrollPageLeft")

const scrollPageUp = () => currentPage()?.send("action", "scrollPageUp")

const scrollPageDownHalf = () => currentPage()?.send(
    "action", "scrollPageDownHalf")

const scrollPageDown = () => currentPage()?.send("action", "scrollPageDown")

const scrollPageUpHalf = () => currentPage()?.send(
    "action", "scrollPageUpHalf")

const nextSearchMatch = () => {
    if (currentSearch) {
        listPages().filter(p => p).forEach(page => {
            try {
                const tab = tabOrPageMatching(page)
                if (tab.classList.contains("visible-tab")) {
                    page.findInPage(currentSearch, {
                        "findNext": true, "matchCase": matchCase()
                    })
                }
            } catch {
                // Page unavailable or suspended
            }
        })
    }
}

const refreshTab = (customPage = null) => {
    const page = customPage || currentPage()
    if (page && !page.isCrashed() && !page.src.startsWith("devtools://")) {
        page.reload()
        const {resetTabInfo} = require("./tabs")
        resetTabInfo(page)
    }
}

const openNewTab = () => {
    const {addTab} = require("./tabs")
    addTab()
}

const reopenTab = () => {
    const {"reopenTab": reopen} = require("./tabs")
    reopen()
}

const nextTab = () => {
    const {switchToTab} = require("./tabs")
    switchToTab(listTabs().indexOf(currentTab()) + 1)
}

const toSearchMode = () => {
    const {setMode} = require("./modes")
    setMode("search")
    document.getElementById("url").value = currentSearch
    document.getElementById("url").select()
}

const startFollowNewSplit = () => {
    const {startFollow} = require("./follow")
    startFollow("ver")
}

const startFollowNewVerSplit = () => {
    const {startFollow} = require("./follow")
    startFollow("hor")
}

const startFollowNewTab = () => {
    const {startFollow} = require("./follow")
    startFollow("newtab")
}

const startFollowCurrentTab = () => {
    const {startFollow} = require("./follow")
    startFollow("current")
}

const backInHistory = (customPage = null) => {
    const page = customPage || currentPage()
    if (page && !page.isCrashed() && !page.src.startsWith("devtools://")) {
        if (page?.canGoBack()) {
            tabOrPageMatching(page).querySelector("span").textContent = ""
            page.goBack()
            const {resetTabInfo} = require("./tabs")
            resetTabInfo(page)
        }
    }
}

const forwardInHistory = (customPage = null) => {
    const page = customPage || currentPage()
    if (page && !page.isCrashed() && !page.src.startsWith("devtools://")) {
        if (page?.canGoForward()) {
            tabOrPageMatching(page).querySelector("span").textContent = ""
            page.goForward()
            const {resetTabInfo} = require("./tabs")
            resetTabInfo(page)
        }
    }
}

const previousSearchMatch = () => {
    if (currentSearch) {
        listPages().filter(p => p).forEach(page => {
            try {
                const tab = tabOrPageMatching(page)
                if (tab.classList.contains("visible-tab")) {
                    page.findInPage(currentSearch, {
                        "findNext": true,
                        "forward": false,
                        "matchCase": matchCase()
                    })
                }
            } catch {
                // Page unavailable or suspended
            }
        })
    }
}

const refreshTabWithoutCache = () => {
    if (currentPage() && !currentPage().isCrashed()) {
        if (!currentPage().src.startsWith("devtools://")) {
            currentPage().reloadIgnoringCache()
            const {resetTabInfo} = require("./tabs")
            resetTabInfo(currentPage())
        }
    }
}

const openNewTabWithCurrentUrl = () => {
    const url = currentPage()?.src || ""
    const {addTab} = require("./tabs")
    addTab()
    const {setMode} = require("./modes")
    setMode("explore")
    document.getElementById("url").value = urlToString(url)
}

const toCommandMode = () => {
    const {setMode} = require("./modes")
    setMode("command")
}

const stopLoadingPage = () => currentPage()?.stop()

const moveTabForward = () => {
    const {"moveTabForward": move} = require("./tabs")
    move()
}

const moveTabBackward = () => {
    const {"moveTabBackward": move} = require("./tabs")
    move()
}

const moveTabEnd = () => {
    const {"moveTabForward": move} = require("./tabs")
    let didMove = move()
    while (didMove) {
        didMove = move()
    }
}

const moveTabStart = () => {
    const {"moveTabBackward": move} = require("./tabs")
    let didMove = move()
    while (didMove) {
        didMove = move()
    }
}

const zoomReset = () => currentPage()?.setZoomLevel(0)

const zoomOut = (customPage = null) => {
    const page = customPage || currentPage()
    let level = page?.getZoomLevel() - 1
    if (level < -7) {
        level = -7
    }
    page?.setZoomLevel(level)
}

const zoomIn = (customPage = null) => {
    const page = customPage || currentPage()
    let level = page?.getZoomLevel() + 1
    if (level > 7) {
        level = 7
    }
    page?.setZoomLevel(level)
}

const toNormalMode = () => {
    const {setMode} = require("./modes")
    setMode("normal")
}

const stopFollowMode = () => {
    const {setMode} = require("./modes")
    if (currentMode() === "follow") {
        setMode(getStored("modebeforefollow") || "normal")
    } else {
        setMode("normal")
    }
}

const repeatLastAction = () => {
    const {"repeatLastAction": repeat} = require("./input")
    repeat()
}

const editWithVim = () => {
    const page = currentPage()
    if (!page) {
        return
    }
    let typeOfEdit = null
    if (currentMode() === "insert") {
        typeOfEdit = "input"
    }
    if ("ces".includes(currentMode()[0])) {
        typeOfEdit = "navbar"
    }
    if (!typeOfEdit) {
        return
    }
    const fileFolder = joinPath(appData(), "vimformedits")
    makeDir(fileFolder)
    const tempFile = joinPath(fileFolder, String(Number(new Date())))
    let command = null
    watchFile(tempFile, {"interval": 500}, () => {
        if (command) {
            const contents = readFile(tempFile)
            if (contents === null) {
                return
            }
            if (typeOfEdit === "input") {
                sendToPageOrSubFrame("action",
                    "setInputFieldText", tempFile, contents)
            } else if ("ces".includes(currentMode()[0])) {
                document.getElementById("url").value = contents
                const {updateSuggestions} = require("./input")
                updateSuggestions()
            }
        } else {
            const {exec} = require("child_process")
            const commandStr = `${getSetting("vimcommand")} "${tempFile}"`
            command = exec(commandStr, (err, stdout) => {
                const reportExit = getSetting("notificationforsystemcommands")
                if (err && reportExit !== "none") {
                    notify(`${err}`, "err")
                } else if (reportExit === "all") {
                    notify(stdout || "Command exitted successfully!", "suc")
                }
            })
        }
    })
    if (typeOfEdit === "input") {
        sendToPageOrSubFrame("action", "writeInputToFile", tempFile)
    }
    if (typeOfEdit === "navbar") {
        setTimeout(() => writeFile(
            tempFile, document.getElementById("url").value), 3)
    }
}

const downloadLink = () => {
    const {commonAction} = require("./contextmenu")
    commonAction("link", "download", {"link": currentPage()?.src})
}

const openLinkExternal = () => {
    const {commonAction} = require("./contextmenu")
    commonAction("link", "external", {"link": currentPage()?.src})
}

const nextSuggestion = () => {
    const {next} = require("./suggest")
    next()
    setFocusCorrectly()
}

const prevSuggestion = () => {
    const {previous} = require("./suggest")
    previous()
    setFocusCorrectly()
}

const nextSuggestionSection = () => {
    const {nextSection} = require("./suggest")
    nextSection()
    setFocusCorrectly()
}

const prevSuggestionSection = () => {
    const {previousSection} = require("./suggest")
    previousSection()
    setFocusCorrectly()
}

const commandHistoryPrevious = () => {
    const {previous} = require("./commandhistory")
    previous()
}

const commandHistoryNext = () => {
    const {next} = require("./commandhistory")
    next()
}

const exploreHistoryPrevious = () => {
    const {previous} = require("./explorehistory")
    previous()
}

const exploreHistoryNext = () => {
    const {next} = require("./explorehistory")
    next()
}

const rotateSplitWindowForward = () => {
    const {rotateForward} = require("./pagelayout")
    rotateForward()
}

const rotateSplitWindowBackward = () => {
    const {rotateReverse} = require("./pagelayout")
    rotateReverse()
}

const leftHalfSplitWindow = () => {
    const {toTop} = require("./pagelayout")
    toTop("left")
}

const bottomHalfSplitWindow = () => {
    const {toTop} = require("./pagelayout")
    toTop("bottom")
}

const topHalfSplitWindow = () => {
    const {toTop} = require("./pagelayout")
    toTop("top")
}

const rightHalfSplitWindow = () => {
    const {toTop} = require("./pagelayout")
    toTop("right")
}

const toLeftSplitWindow = () => {
    const {moveFocus} = require("./pagelayout")
    moveFocus("left")
}

const toBottomSplitWindow = () => {
    const {moveFocus} = require("./pagelayout")
    moveFocus("bottom")
}

const toTopSplitWindow = () => {
    const {moveFocus} = require("./pagelayout")
    moveFocus("top")
}

const toRightSplitWindow = () => {
    const {moveFocus} = require("./pagelayout")
    moveFocus("right")
}

const toLastSplitWindow = () => {
    const {lastSplit} = require("./pagelayout")
    lastSplit()
}

const toFirstSplitWindow = () => {
    const {firstSplit} = require("./pagelayout")
    firstSplit()
}

const toNextSplitWindow = () => {
    const {nextSplit} = require("./pagelayout")
    nextSplit()
}

const toPreviousSplitWindow = () => {
    const {previousSplit} = require("./pagelayout")
    previousSplit()
}

const exchangeSplitWindow = () => {
    const {exchange} = require("./pagelayout")
    exchange()
}

const increaseHeightSplitWindow = () => {
    const {resize} = require("./pagelayout")
    resize("ver", "grow")
}

const decreaseHeightSplitWindow = () => {
    const {resize} = require("./pagelayout")
    resize("ver", "shrink")
}

const increaseWidthSplitWindow = () => {
    const {resize} = require("./pagelayout")
    resize("hor", "grow")
}

const decreaseWidthSplitWindow = () => {
    const {resize} = require("./pagelayout")
    resize("hor", "shrink")
}

const distrubuteSpaceSplitWindow = () => {
    const {resetResizing} = require("./pagelayout")
    resetResizing()
}

const toggleAlwaysOnTop = () => ipcRenderer.invoke("toggle-always-on-top")

const toggleFullscreen = () => {
    ipcRenderer.invoke("toggle-fullscreen").then(updateGuiVisibility)
}

const matchCase = () => {
    if (getSetting("smartcase")) {
        return currentSearch !== currentSearch.toLowerCase()
    }
    return !getSetting("ignorecase")
}

const incrementalSearch = (value = null) => {
    currentSearch = value || document.getElementById("url").value
    if (currentSearch) {
        listPages().filter(p => p).forEach(page => {
            try {
                page.stopFindInPage("clearSelection")
                const tab = tabOrPageMatching(page)
                if (tab.classList.contains("visible-tab")) {
                    page.findInPage(currentSearch, {"matchCase": matchCase()})
                }
            } catch {
                // Page unavailable or suspended
            }
        })
    } else {
        emptySearch()
    }
}

const getPageUrl = () => {
    let url = currentPage().src
    if (getSetting("encodeurlcopy") === "spacesonly") {
        url = url.replace(/ /g, "%20")
    } else if (getSetting("encodeurlcopy") === "nospaces") {
        url = urlToString(url).replace(/ /g, "%20")
    } else if (getSetting("encodeurlcopy") === "decode") {
        url = urlToString(url)
    } else if (getSetting("encodeurlcopy") === "encode") {
        url = stringToUrl(url)
    }
    return url
}

const pageToClipboard = () => clipboard.writeText(getPageUrl())

const pageTitleToClipboard = () => {
    clipboard.writeText(currentTab().querySelector("span").textContent)
}

const pageToClipboardHTML = () => {
    const url = getPageUrl()
    const title = currentTab().querySelector("span").textContent
    clipboard.writeText(`<a href="${url}">${title}</a>`)
}

const pageToClipboardMarkdown = () => {
    const url = getPageUrl()
    const title = currentTab().querySelector("span").textContent
    clipboard.writeText(`[${title}](${url})`)
}

const pageToClipboardRST = () => {
    const url = getPageUrl()
    const title = currentTab().querySelector("span").textContent
    clipboard.writeText(`\`${title} <${url}>\`_`)
}

const pageToClipboardEmacs = () => {
    const url = getPageUrl()
    const title = currentTab().querySelector("span").textContent
    clipboard.writeText(`[[${url}][${title}]]`)
}

const openFromClipboard = () => {
    if (clipboard.readText().trim()) {
        const {navigateTo} = require("./tabs")
        navigateTo(stringToUrl(clipboard.readText()))
    }
}

const reorderFollowLinks = () => {
    const {reorderDisplayedLinks} = require("./follow")
    reorderDisplayedLinks()
}

const menuOpen = () => {
    if (currentMode() === "normal") {
        const tab = currentTab()
        const bounds = tab.getBoundingClientRect()
        const {viebMenu} = require("./contextmenu")
        viebMenu({
            "path": [tab, document.getElementById("tabs")],
            "x": bounds.x,
            "y": bounds.y + bounds.height
        })
    } else if (currentMode() === "insert") {
        sendToPageOrSubFrame("contextmenu")
    } else if ("sec".includes(currentMode()[0])) {
        const selected = document.querySelector("#suggest-dropdown .selected")
        let bounds = selected?.getBoundingClientRect()
        if (currentMode() === "command" && selected) {
            const {commandMenu} = require("./contextmenu")
            commandMenu({
                "command": selected.querySelector("span").textContent,
                "x": bounds.x,
                "y": bounds.y + bounds.height
            })
        } else if (currentMode() === "explore" && selected) {
            const {linkMenu} = require("./contextmenu")
            linkMenu({
                "link": selected.querySelector(".url").textContent,
                "x": bounds.x,
                "y": bounds.y + bounds.height
            })
        } else {
            const url = document.getElementById("url")
            bounds = url.getBoundingClientRect()
            const charWidth = getSetting("guifontsize") * 0.60191
            const {viebMenu} = require("./contextmenu")
            viebMenu({
                "path": [url],
                "x": bounds.x + charWidth * url.selectionStart - url.scrollLeft,
                "y": bounds.y + bounds.height
            })
        }
    } else {
        const {rightClick} = require("./pointer")
        rightClick()
    }
}

const menuTop = () => {
    const {top} = require("./contextmenu")
    top()
}

const menuSectionUp = () => {
    const {sectionUp} = require("./contextmenu")
    sectionUp()
}

const menuUp = () => {
    const {up} = require("./contextmenu")
    up()
}

const menuDown = () => {
    const {down} = require("./contextmenu")
    down()
}

const menuSectionDown = () => {
    const {sectionDown} = require("./contextmenu")
    sectionDown()
}

const menuBottom = () => {
    const {bottom} = require("./contextmenu")
    bottom()
}

const menuSelect = () => {
    const {select} = require("./contextmenu")
    select()
}

const menuClose = () => {
    const {clear} = require("./contextmenu")
    clear()
}

const useEnteredData = () => {
    const {setMode} = require("./modes")
    if (currentMode() === "command") {
        const command = document.getElementById("url").value.trim()
        setMode("normal")
        const {push} = require("./commandhistory")
        push(command, true)
        const {execute} = require("./command")
        execute(command)
    }
    if (currentMode() === "search") {
        incrementalSearch()
        setMode("normal")
    }
    if (currentMode() === "explore") {
        const urlElement = document.getElementById("url")
        let location = urlElement.value.trim()
        setMode("normal")
        if (location) {
            location = searchword(location).url
            const {push} = require("./explorehistory")
            push(urlToString(location))
            const {navigateTo} = require("./tabs")
            navigateTo(stringToUrl(location))
        }
    }
}

const nop = () => {
    // Explicit No-op action: does nothing
}

const setFocusCorrectly = () => {
    const urlElement = document.getElementById("url")
    const {updateUrl} = require("./tabs")
    const {followFiltering} = require("./follow")
    updateUrl(currentPage())
    if (currentMode() === "insert") {
        urlElement.blur()
        currentPage()?.focus()
        if (!document.getElementById("context-menu").innerText) {
            currentPage()?.click()
        }
    } else if ("sec".includes(currentMode()[0]) || followFiltering()) {
        if (document.activeElement !== urlElement) {
            window.focus()
            urlElement.focus()
        }
    } else {
        urlElement.blur()
        window.focus()
        document.body.focus()
    }
}

module.exports = {
    backInHistory,
    bottomHalfSplitWindow,
    clickOnSearch,
    commandHistoryNext,
    commandHistoryPrevious,
    decreaseFirstNumber,
    decreaseHeightSplitWindow,
    decreaseLastNumber,
    decreasePageNumber,
    decreasePortNumber,
    decreaseWidthSplitWindow,
    distrubuteSpaceSplitWindow,
    downloadLink,
    editWithVim,
    emptySearch,
    exchangeSplitWindow,
    exploreHistoryNext,
    exploreHistoryPrevious,
    forwardInHistory,
    increaseFirstNumber,
    increaseHeightSplitWindow,
    increaseLastNumber,
    increasePageNumber,
    increasePortNumber,
    increaseWidthSplitWindow,
    incrementalSearch,
    insertAtFirstInput,
    leftHalfSplitWindow,
    menuBottom,
    menuClose,
    menuDown,
    menuOpen,
    menuSectionDown,
    menuSectionUp,
    menuSelect,
    menuTop,
    menuUp,
    moveTabBackward,
    moveTabEnd,
    moveTabForward,
    moveTabStart,
    nextPage,
    nextPageNewTab,
    nextSearchMatch,
    nextSuggestion,
    nextSuggestionSection,
    nextTab,
    nop,
    openFromClipboard,
    openLinkExternal,
    openNewTab,
    openNewTabWithCurrentUrl,
    pageTitleToClipboard,
    pageToClipboard,
    pageToClipboardEmacs,
    pageToClipboardHTML,
    pageToClipboardMarkdown,
    pageToClipboardRST,
    prevSuggestion,
    prevSuggestionSection,
    previousPage,
    previousPageNewTab,
    previousSearchMatch,
    previousTab,
    refreshTab,
    refreshTabWithoutCache,
    reopenTab,
    reorderFollowLinks,
    repeatLastAction,
    rightHalfSplitWindow,
    rotateSplitWindowBackward,
    rotateSplitWindowForward,
    scrollBottom,
    scrollDown,
    scrollLeft,
    scrollLeftMax,
    scrollPageDown,
    scrollPageDownHalf,
    scrollPageLeft,
    scrollPageRight,
    scrollPageUp,
    scrollPageUpHalf,
    scrollRight,
    scrollRightMax,
    scrollTop,
    scrollUp,
    setFocusCorrectly,
    startFollowCurrentTab,
    startFollowNewSplit,
    startFollowNewTab,
    startFollowNewVerSplit,
    stopFollowMode,
    stopLoadingPage,
    toBottomSplitWindow,
    toCommandMode,
    toExploreMode,
    toFirstSplitWindow,
    toInsertMode,
    toLastSplitWindow,
    toLeftSplitWindow,
    toNextSplitWindow,
    toNormalMode,
    toParentSubdomain,
    toParentUrl,
    toPreviousSplitWindow,
    toRightSplitWindow,
    toRootSubdomain,
    toRootUrl,
    toSearchMode,
    toTopSplitWindow,
    toggleAlwaysOnTop,
    toggleFullscreen,
    toggleReaderView,
    toggleReaderViewNewTab,
    toggleSourceViewer,
    toggleSourceViewerNewTab,
    topHalfSplitWindow,
    useEnteredData,
    zoomIn,
    zoomOut,
    zoomReset
}
