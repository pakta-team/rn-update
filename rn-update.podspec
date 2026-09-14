require 'json'
require 'rubygems' # Required for version comparison


new_arch_enabled = ENV['RCT_NEW_ARCH_ENABLED'] == '1'
package = JSON.parse(File.read(File.join(__dir__, 'package.json')))
podspec_dir = File.dirname(__FILE__)

=begin
[INPUT]: 依赖 package.json 的包元数据，以及 CocoaPods、React Native、Expo 与共享 C++ 内核的原生接口。
[OUTPUT]: 对外提供 rn-update 的 CocoaPods 规格、iOS 原生源文件、资源包与条件式 Expo 接入。
[POS]: SDK 发布边界，负责把 npm 包版本映射到 Apple 原生依赖与资源；Android、HarmonyOS 与 JavaScript 实现由同级目录独立维护。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
=end

Pod::Spec.new do |s|

  is_expo_in_podfile = false
  begin
    # Check Podfile for use_expo_modules!
    podfile_path = File.join(Pod::Config.instance.installation_root, 'Podfile')
    if File.exist?(podfile_path)
      podfile_content = File.read(podfile_path)
      is_expo_in_podfile = podfile_content.include?('use_expo_modules!')
    end
  rescue => e
     # Silently ignore errors during check
  end

  # Determine final validity by checking Podfile presence AND Expo version
  valid_expo_project = false # Default
  if is_expo_in_podfile
    # Only check expo version if use_expo_modules! is present
    is_version_sufficient = false
    begin
        expo_version_str = `node --print \"require('expo/package.json').version\"`.strip
        if expo_version_str && !expo_version_str.empty?
          match = expo_version_str.match(/^\d+/)
          if match
            major_version = match[0].to_i
            is_version_sufficient = major_version >= 50
          end
        end
    rescue
        # Node command failed, version remains insufficient
    end
    
    # Final check
    valid_expo_project = is_version_sufficient
  end

  # Set platform based on whether it's a valid Expo project and if we can parse its target
  final_ios_deployment_target = '11.0' # Default target

  if valid_expo_project
    # --- Try to find and parse ExpoModulesCore.podspec only if it's an Expo project ---
    parsed_expo_ios_target = nil
    expo_modules_core_podspec_path = begin
        package_json_path = `node -p "require.resolve('expo-modules-core/package.json')"`.strip
        File.join(File.dirname(package_json_path), 'ExpoModulesCore.podspec') if $?.success? && package_json_path && !package_json_path.empty?
    rescue
        nil
    end

    if expo_modules_core_podspec_path && File.exist?(expo_modules_core_podspec_path)
      begin
        content = File.read(expo_modules_core_podspec_path)
        match = content.match(/s\.platforms\s*=\s*\{[\s\S]*?:ios\s*=>\s*'([^\']+)'/) # Match within s.platforms hash
        if match && match[1]
          parsed_expo_ios_target = match[1]
        else
          match = content.match(/s\.platform\s*=\s*:ios,\s*'([^\']+)'/) # Fallback to s.platform = :ios, 'version'
          if match && match[1]
            parsed_expo_ios_target = match[1]
          end
        end
      rescue => e
        # Pod::UI.warn "Failed to read or parse ExpoModulesCore.podspec content: #{e.message}"
      end
    end
    if parsed_expo_ios_target
        final_ios_deployment_target = parsed_expo_ios_target
    end
  end

  s.platforms = { :ios => final_ios_deployment_target }

  s.name         = package['name']
  s.version      = package['version']
  s.summary      = package['description']
  s.license      = package['license']

  s.authors      = package['author']
  s.homepage     = package['homepage']

  s.cocoapods_version = '>= 1.6.0'

  s.source = { :git => 'https://github.com/pakta-team/rn-update.git', :tag => "#{s.version}" }

  s.libraries = 'bz2', 'z'
  # No search path into the pod source: every include under ios/ resolves
  # relative to the including file (the cpp/ core via ../../cpp/...), and the
  # former absolute "#{podspec_dir}/ios" entry made the generated xcconfig
  # machine-specific.
  # Expo 的 DEFINES_MODULE 会为模块生成 umbrella header；公共头实际会被
  # CocoaPods 复制到以 Pod 名称命名的路径，必须把当前包的路径加入搜索范围。
  s.pod_target_xcconfig = { 
    'USER_HEADER_SEARCH_PATHS' => "\"$(PODS_ROOT)/Headers/Public/rn-update\" \"$(PODS_ROOT)/Headers/Public/SSZipArchive\" \"$(PODS_ROOT)/Headers/Public/React-Codegen/RCTPaktaSpec\"",
    "DEFINES_MODULE" => "YES" 
  }
  # buildTime for binary-rebuild detection (SyncBinaryVersion) and the check
  # request. The stamp is an opaque UUID refreshed on every build and ships as
  # a resource; it is never a timestamp or ordering signal.
  # When the pod source is not writable (read-only checkout or cache) the
  # committed value is kept; +buildTime falls back to a generated UUID when
  # the file is missing or empty, so it remains opaque and never blank.
  s.resource = 'ios/pakta_build_time.txt'
  build_time_phase = {
    :name => 'Generate build time',
    :script => "set -x; f=\"${PODS_TARGET_SRCROOT:-#{podspec_dir}}/ios/pakta_build_time.txt\"; if [ -w \"$f\" ] || { [ ! -e \"$f\" ] && [ -w \"$(dirname \"$f\")\" ]; }; then uuidgen | tr '[:upper:]' '[:lower:]' > \"$f\"; else echo \"warning: $f is not writable, keeping the shipped build time\"; fi",
    :execution_position => :before_compile
  }
  # Declaring the output lets Xcode order the resource copy (into the app, or
  # into this pod's framework under use_frameworks!) after the stamp is
  # written and stops the output-less-phase warning. A phase with outputs and
  # no inputs is otherwise skipped once the file exists — and it is committed
  # — so the phase must also be marked always out of date to keep refreshing
  # the stamp every build. CocoaPods < 1.11 has no such key; there the phase
  # stays output-less (runs every build, as before).
  if defined?(Pod::Specification::DSL::SCRIPT_PHASE_OPTIONAL_KEYS) &&
     Pod::Specification::DSL::SCRIPT_PHASE_OPTIONAL_KEYS.include?(:always_out_of_date)
    build_time_phase[:output_files] = ['$(PODS_TARGET_SRCROOT)/ios/pakta_build_time.txt']
    build_time_phase[:always_out_of_date] = '1'
  end
  s.script_phase = build_time_phase
  # Privacy manifest (required-reason APIs: disk space, file timestamps,
  # system boot time, user defaults) delivered as its own resource bundle so
  # static and dynamic integrations both carry it.
  s.resource_bundles = { 'react-native-update_privacy' => ['ios/PrivacyInfo.xcprivacy'] }

  s.dependency 'React'
  s.dependency "React-Core"
  # The unzip guard relies on the 2.x delegate contract
  # (zipArchiveShouldUnzipFileAtIndex:... cancels, _sanitizedPath); a future
  # major could change it silently.
  s.dependency 'SSZipArchive', '~> 2.4'

  # Conditionally add Expo dependency
  if valid_expo_project
    # DEFINES_MODULE 的 umbrella 会列出公共头；仅声明 public_header_files
    # 不会把 ImportReact.h 放入 Headers/Public，Expo Swift 模块因此无法编译。
    s.source_files = 'ios/ImportReact.h'
    s.public_header_files = ['ios/ImportReact.h']
    s.dependency 'ExpoModulesCore'
  end

  s.subspec 'RCTPakta' do |ss|
    ss.source_files = ['ios/RCTPakta/*.{h,m,mm}',
                       'cpp/update_flow_core/flow_json.{h,cpp}',
                       'cpp/update_flow_core/update_flow_core.{h,cpp}',
                       'cpp/patch_core/archive_patch_core.{h,cpp}',
                       'cpp/patch_core/digest.{h,cpp}',
                       'cpp/patch_core/hbc_transform.{h,cpp}',
                       'cpp/patch_core/hbc_transform_wire.{h,cpp}',
                       'cpp/patch_core/patch_core.{h,cpp}',
                       'cpp/patch_core/state_core.{h,cpp}',
                       'android/jni/hpatch.{h,c}',
                       'android/jni/HDiffPatch/libHDiffPatch/HPatch/*.{h,c}',
                       'android/jni/HDiffPatch/file_for_patch.{h,c}',
                       'android/jni/lzma/C/LzmaDec.{h,c}',
                       'android/jni/lzma/C/Lzma2Dec.{h,c}']
    ss.public_header_files = ['ios/RCTPakta/*.h']
  end

  # Conditionally add Expo subspec and check ExpoModulesCore version
  if valid_expo_project
    supports_bundle_url_final = false # Default

    # 1. Try executing node to get the version string
    expo_modules_core_version_str = begin
      # Use node to directly require expo-modules-core/package.json and get its version
      `node --print \"require('expo-modules-core/package.json').version\"` # Execute, keep raw output
    rescue
      # Node command failed (e.g., node not found, package not found). Return empty string.
      ''
    end

    # 2. Process the obtained version string (if not empty)
    if expo_modules_core_version_str && !expo_modules_core_version_str.empty?
        begin
            # Compare versions using Gem::Version (handles trailing newline)
            installed_version = Gem::Version.new(expo_modules_core_version_str)
            target_version = Gem::Version.new('1.12.0')
            supports_bundle_url_final = installed_version >= target_version
        rescue ArgumentError
            # If Gem::Version fails parsing, supports_bundle_url_final remains false.
        end
    end

    s.subspec 'Expo' do |ss|
      ss.source_files = 'ios/Expo/**/*.{h,m,mm,swift}'
      if supports_bundle_url_final
        ss.pod_target_xcconfig = { 'SWIFT_ACTIVE_COMPILATION_CONDITIONS' => 'EXPO_SUPPORTS_BUNDLEURL' }
      end
    end
  end

  if defined?(install_modules_dependencies()) != nil
    install_modules_dependencies(s);
  else
    if new_arch_enabled
      folly_compiler_flags = '-DFOLLY_NO_CONFIG -DFOLLY_MOBILE=1 -DFOLLY_USE_LIBCPP=1 -Wno-comma -Wno-shorten-64-to-32'

      s.compiler_flags = folly_compiler_flags + " -DRCT_NEW_ARCH_ENABLED=1"

      s.pod_target_xcconfig = {
          "HEADER_SEARCH_PATHS" => "\"$(PODS_ROOT)/boost\"",
          "CLANG_CXX_LANGUAGE_STANDARD" => "c++17"
      }.merge(s.pod_target_xcconfig)
      s.dependency "React-Codegen"
      s.dependency "RCT-Folly"
      s.dependency "RCTRequired"
      s.dependency "RCTTypeSafety"
      s.dependency "ReactCommon/turbomodule/core"
    end
  end
end
