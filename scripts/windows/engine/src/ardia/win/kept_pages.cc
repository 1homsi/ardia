#include "ardia/win/kept_pages.h"

#include "ardia/win/host.h"
#include "ardia/win/page_links.h"
#include "ardia/win/tab_calls.h"
#include "base/functional/function_ref.h"
#include "base/memory/scoped_refptr.h"
#include "components/performance_manager/public/graph/frame_node.h"
#include "components/performance_manager/public/graph/page_node.h"
#include "content/public/browser/ardia_live_connection.h"
#include "content/public/browser/devtools_agent_host.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"

namespace performance_manager::policies {
extern bool (*g_ardia_keeps_page)(const PageNode* page_node);
}

namespace ardia_win {

namespace {

using performance_manager::FrameNode;
using performance_manager::PageNode;

void VisitFrames(const FrameNode* frame,
                 base::FunctionRef<void(const FrameNode*)> visit) {
  visit(frame);
  for (const FrameNode* child : frame->GetChildFrameNodes()) {
    VisitFrames(child, visit);
  }
}

bool InspectedByAnotherClient(content::WebContents* contents) {
  if (!content::DevToolsAgentHost::HasFor(contents)) {
    return false;
  }
  scoped_refptr<content::DevToolsAgentHost> host =
      content::DevToolsAgentHost::GetOrCreateFor(contents);
  std::vector<const content::DevToolsAgentHostClient*> ours;
  if (const PageLinks* links = PageLinks::FromWebContents(contents)) {
    ours.push_back(links);
  }
  if (const content::DevToolsAgentHostClient* caller =
          EngineDevToolsClient(contents)) {
    ours.push_back(caller);
  }
  return host && content::ArdiaHasOtherDevToolsClient(host.get(), ours);
}

bool HasLiveConnection(const PageNode* page, content::WebContents* contents) {
  bool live = page->UsesWebRTC();
  if (contents) {
    contents->GetPrimaryMainFrame()->ForEachRenderFrameHost(
        [&live](content::RenderFrameHost* frame) {
          live = live || content::ArdiaFrameHasLiveConnection(frame);
        });
  }
  return live;
}

bool KeepsPage(const PageNode* page) {
  return !KeptBy(page).empty();
}

}

std::vector<int> KeptBy(const PageNode* page) {
  std::vector<int> codes;
  if (!page) {
    return codes;
  }
  bool unsaved = false;
  bool used = false;
  bool web_lock = false;
  bool indexed_db_lock = false;
  for (const FrameNode* main : page->GetMainFrameNodes()) {
    VisitFrames(main, [&](const FrameNode* frame) {
      unsaved = unsaved || frame->HasNonemptyBeforeUnload();
      used = used || frame->HadUserActivation();
      web_lock = web_lock || frame->IsHoldingWebLock();
      indexed_db_lock =
          indexed_db_lock || frame->IsHoldingBlockingIndexedDBLock();
    });
  }
  base::WeakPtr<content::WebContents> contents = page->GetWebContents();
  if (contents && Host::Get()->OpensLivePage(contents.get())) {
    codes.push_back(kOpensLivePage);
  }
  if (unsaved && used) {
    codes.push_back(kUnsavedAfterUse);
  }
  if (web_lock) {
    codes.push_back(kHoldsWebLock);
  }
  if (indexed_db_lock) {
    codes.push_back(kHoldsBlockingIndexedDBLock);
  }
  if (HasLiveConnection(page, contents.get())) {
    codes.push_back(kLiveConnection);
  }
  if (contents && InspectedByAnotherClient(contents.get())) {
    codes.push_back(kInspectedByAnotherClient);
  }
  return codes;
}

void AskBeforeDiscards() {
  performance_manager::policies::g_ardia_keeps_page = &KeepsPage;
}

}
