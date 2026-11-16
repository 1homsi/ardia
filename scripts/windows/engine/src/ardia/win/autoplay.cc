#include "ardia/win/autoplay.h"

#include <set>
#include <string>

#include "ardia/win/tab_state.h"
#include "base/functional/bind.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/strings/strcat.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/single_thread_task_runner.h"
#include "base/time/time.h"
#include "chrome/browser/content_settings/host_content_settings_map_factory.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/common/chrome_isolated_world_ids.h"
#include "components/content_settings/core/browser/content_settings_observer.h"
#include "components/content_settings/core/browser/content_settings_type_set.h"
#include "components/content_settings/core/browser/host_content_settings_map.h"
#include "components/content_settings/core/common/content_settings.h"
#include "components/content_settings/core/common/content_settings_pattern.h"
#include "components/content_settings/core/common/content_settings_types.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/page.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_observer.h"
#include "content/public/browser/web_contents_user_data.h"
#include "third_party/blink/public/mojom/frame/user_activation_notification_type.mojom.h"
#include "url/gurl.h"

extern bool (*g_ardia_win_autoplay_blocked)(content::WebContents* contents,
                                            const GURL& url);

namespace ardia_win {

namespace {

constexpr char kHeldMessage[] =
    "Media waits for a user gesture before it plays.";
constexpr int kMostCountedPerPage = 20;
constexpr base::TimeDelta kCountDelay = base::Seconds(1);

constexpr char kGuardStart[] =
    "(() => {"
    "if (!window.ardiaAutoplayGuard) {"
    "let block = false;"
    "const asked = () => !!(navigator.userActivation &&"
    " navigator.userActivation.hasBeenActive);"
    "const stop = (media) => {"
    "media.pause();"
    "console.debug(\"";
constexpr char kGuardMiddle[] =
    "\");"
    "};"
    "document.addEventListener(\"play\", (event) => {"
    "const media = event.target;"
    "if (block && media instanceof HTMLMediaElement && !asked()) stop(media);"
    "}, true);"
    "window.ardiaAutoplayGuard = (next) => {"
    "block = next;"
    "if (!block || asked()) return;"
    "for (const media of document.querySelectorAll(\"video, audio\"))"
    " if (!media.paused) stop(media);"
    "};"
    "}"
    "window.ardiaAutoplayGuard(";
constexpr char kGuardEnd[] = ");})();";

bool g_block_everywhere = false;

HostContentSettingsMap* SettingsFor(content::WebContents* contents) {
  return contents ? HostContentSettingsMapFactory::GetForProfile(
                        Profile::FromBrowserContext(
                            contents->GetBrowserContext()))
                  : nullptr;
}

bool BlockedAt(content::WebContents* contents, const GURL& url) {
  if (!url.SchemeIsHTTPOrHTTPS()) {
    return false;
  }
  HostContentSettingsMap* settings = SettingsFor(contents);
  if (!settings) {
    return false;
  }
  content_settings::SettingInfo info;
  const ContentSetting value = settings->GetContentSetting(
      url, url, ContentSettingsType::AUTOPLAY, &info);
  return value == CONTENT_SETTING_BLOCK ||
         (g_block_everywhere && info.primary_pattern.MatchesAllHosts());
}

std::u16string GuardScript(bool block) {
  return base::UTF8ToUTF16(base::StrCat({kGuardStart, kHeldMessage,
                                         kGuardMiddle,
                                         block ? "true" : "false",
                                         kGuardEnd}));
}

class AutoplayGuard : public content::WebContentsObserver,
                      public content::WebContentsUserData<AutoplayGuard>,
                      public content_settings::Observer {
 public:
  AutoplayGuard(const AutoplayGuard&) = delete;
  AutoplayGuard& operator=(const AutoplayGuard&) = delete;
  ~AutoplayGuard() override {
    Live().erase(this);
    StopObserving();
  }

  static std::set<AutoplayGuard*>& Live() {
    static base::NoDestructor<std::set<AutoplayGuard*>> live;
    return *live;
  }

  void Refresh() {
    if (!web_contents()) {
      return;
    }
    const bool blocked = AutoplayBlocked(web_contents());
    if (blocked == blocked_) {
      return;
    }
    blocked_ = blocked;
    web_contents()->OnWebPreferencesChanged();
    InstallEverywhere();
  }

 private:
  friend class content::WebContentsUserData<AutoplayGuard>;

  explicit AutoplayGuard(content::WebContents* contents)
      : content::WebContentsObserver(contents),
        content::WebContentsUserData<AutoplayGuard>(*contents),
        settings_(SettingsFor(contents)),
        blocked_(AutoplayBlocked(contents)) {
    if (settings_) {
      settings_->AddObserver(this);
    }
    Live().insert(this);
    InstallEverywhere();
  }

  void InstallEverywhere() {
    web_contents()->GetPrimaryMainFrame()->ForEachRenderFrameHost(
        [this](content::RenderFrameHost* frame) { Install(frame); });
  }

  void Install(content::RenderFrameHost* frame) {
    if (!frame || !frame->IsRenderFrameLive() ||
        frame->GetLastCommittedURL().is_empty()) {
      return;
    }
    frame->ExecuteJavaScriptInIsolatedWorld(GuardScript(blocked_),
                                            base::NullCallback(),
                                            ISOLATED_WORLD_ID_CHROME_INTERNAL);
  }

  void DidFinishNavigation(content::NavigationHandle* handle) override {
    if (!handle->HasCommitted() || handle->IsSameDocument()) {
      return;
    }
    if (handle->IsInPrimaryMainFrame()) {
      blocked_ = AutoplayBlocked(web_contents());
    }
    Install(handle->GetRenderFrameHost());
  }

  void PrimaryPageChanged(content::Page& page) override {
    counted_on_page_ = 0;
  }

  void OnDidAddMessageToConsole(
      content::RenderFrameHost* source_frame,
      blink::mojom::ConsoleMessageLevel log_level,
      const std::u16string& message,
      int32_t line_no,
      const std::u16string& source_id,
      const std::optional<std::u16string>& untrusted_stack_trace) override {
    if (log_level != blink::mojom::ConsoleMessageLevel::kVerbose ||
        base::UTF16ToUTF8(message) != kHeldMessage ||
        !blocked_ || counted_on_page_ >= kMostCountedPerPage) {
      return;
    }
    ++counted_on_page_;
    if (unsent_++ == 0) {
      base::SingleThreadTaskRunner::GetCurrentDefault()->PostDelayedTask(
          FROM_HERE,
          base::BindOnce(&AutoplayGuard::SendCount,
                         weak_factory_.GetWeakPtr()),
          kCountDelay);
    }
  }

  void SendCount() {
    if (!unsent_ || !web_contents()) {
      return;
    }
    if (TabState* state = TabState::FromWebContents(web_contents())) {
      base::DictValue data;
      data.Set("count", unsent_);
      state->Send("autoplayBlocked", std::move(data));
    }
    unsent_ = 0;
  }

  void OnContentSettingChanged(const ContentSettingsPattern& primary_pattern,
                               const ContentSettingsPattern& secondary_pattern,
                               ContentSettingsTypeSet types) override {
    if (types.Contains(ContentSettingsType::AUTOPLAY)) {
      Refresh();
    }
  }

  void WebContentsDestroyed() override { StopObserving(); }

  void StopObserving() {
    if (settings_) {
      settings_->RemoveObserver(this);
    }
    settings_ = nullptr;
  }

  raw_ptr<HostContentSettingsMap> settings_;
  bool blocked_;
  int counted_on_page_ = 0;
  int unsent_ = 0;
  base::WeakPtrFactory<AutoplayGuard> weak_factory_{this};
  WEB_CONTENTS_USER_DATA_KEY_DECL();
};

WEB_CONTENTS_USER_DATA_KEY_IMPL(AutoplayGuard);

}

bool AutoplayBlocked(content::WebContents* contents) {
  return contents && BlockedAt(contents, contents->GetLastCommittedURL());
}

void InstallAutoplayPolicy() {
  g_ardia_win_autoplay_blocked = [](content::WebContents* contents,
                                    const GURL& url) {
    return contents && BlockedAt(contents, url);
  };
}

void WatchAutoplay(content::WebContents* contents) {
  if (contents && !AutoplayGuard::FromWebContents(contents)) {
    AutoplayGuard::CreateForWebContents(contents);
  }
}

base::DictValue SetBlockAutoplayEverywhere(const base::DictValue& args) {
  const bool enabled = args.FindBool("enabled").value_or(false);
  if (enabled != g_block_everywhere) {
    g_block_everywhere = enabled;
    for (AutoplayGuard* guard :
         std::set<AutoplayGuard*>(AutoplayGuard::Live())) {
      if (AutoplayGuard::Live().contains(guard)) {
        guard->Refresh();
      }
    }
  }
  base::DictValue result;
  result.Set("ok", true);
  result.Set("everywhere", g_block_everywhere);
  return result;
}

void NoteMediaAskedFor(content::WebContents* contents) {
  if (!contents) {
    return;
  }
  contents->GetPrimaryMainFrame()->ForEachRenderFrameHost(
      [](content::RenderFrameHost* frame) {
        if (frame->IsRenderFrameLive()) {
          frame->NotifyUserActivation(
              blink::mojom::UserActivationNotificationType::kInteraction);
        }
      });
}

}
