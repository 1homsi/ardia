#ifndef ARDIA_WIN_AUTOPLAY_H_
#define ARDIA_WIN_AUTOPLAY_H_

#include "base/values.h"

namespace content {
class WebContents;
}

namespace ardia_win {

void InstallAutoplayPolicy();
void WatchAutoplay(content::WebContents* contents);
bool AutoplayBlocked(content::WebContents* contents);
base::DictValue SetBlockAutoplayEverywhere(const base::DictValue& args);
void NoteMediaAskedFor(content::WebContents* contents);

}

#endif
