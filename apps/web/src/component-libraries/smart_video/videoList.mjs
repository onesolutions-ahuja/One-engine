/** The videos to play: one URL, or several separated by ";" or new lines (http(s) or site paths only). */
export const videoList=value=>String(value??"").split(/[;\n]+/).map(item=>item.trim())
 .filter(item=>/^(https?:\/\/|\/)[^\s"'<>]+$/i.test(item));
