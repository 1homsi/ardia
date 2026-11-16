#ifndef ARDIA_WIN_LAUNCH_GUARD_H_
#define ARDIA_WIN_LAUNCH_GUARD_H_

#include <string>

namespace ardia_win {

inline constexpr int kUnfinishedStartsBeforeRecovery = 2;
inline constexpr int kStartSettlesAfterSeconds = 15;
inline constexpr int kPredecessorWaitSeconds = 45;

struct LaunchGuardFacts {
  int predecessor_wait_ms = -1;
  int unfinished_starts_before = 0;
  std::wstring recovered_to;
};

std::wstring AppDataDirectory();

std::wstring LaunchLogPath();

void RotateLaunchLog();

void GuardBrowserLaunch(const std::wstring& chromium_user_data_dir);

void MarkExiting();

void MarkStartSettled();

const LaunchGuardFacts& GuardFacts();

int NextUnfinishedStarts(int recorded, bool* recover);

}

#endif
