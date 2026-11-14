import { NO_LAUNCH_ARGUMENTS, parseLaunchArguments, type LaunchArguments } from "../../lib/launchArguments";
import { launchValues } from "../../platform/launch";

let launch: LaunchArguments = NO_LAUNCH_ARGUMENTS;
let read = false;

export function launchArguments(): LaunchArguments {
  if (!read) {
    read = true;
    launch = parseLaunchArguments(launchValues());
  }
  return launch;
}
