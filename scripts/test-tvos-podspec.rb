# [INPUT]: 依赖真实 rn-update.podspec、CocoaPods Spec/consumer 以及隔离的 RN/Expo 平台夹具
# [OUTPUT]: 验证 v 前缀源码标签、双架构平台、Network 框架、PaktaPrivacy 资源与 Expo 子规格，并拒绝三个命名突变
# [POS]: scripts 的 Apple 规格边界检查，不替代 Xcode 构建或 Foundation 运行
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
require 'cocoapods'
require 'tmpdir'
require 'json'
require 'open3'
require 'rbconfig'

class Pod::Specification
  unless method_defined?(:pod_target_xcconfig)
    def pod_target_xcconfig
      attributes_hash['pod_target_xcconfig'] || {}
    end
  end
end

CASES = [
  ['plain-rn', :absent, nil, '11.0', '15.1'],
  ['rn-ios-only', { :ios => '18.0' }, nil, '17.0', '15.1'],
  ['rn-tvos', { :ios => '18.0', :tvos => '16.4' }, nil, '17.0', '16.4'],
  ['rn-nil', nil, nil, '17.0', '15.1'],
  ['rn-raises', :raises, nil, '17.0', '15.1'],
  ['rn-tvos-nil', { :tvos => nil }, nil, '17.0', '15.1'],
  ['rn-tvos-invalid', { :tvos => 'broken' }, nil, '17.0', '15.1'],
  ['expo-hash-independent', { :tvos => '16.4' }, "s.platforms = { :ios => '18.0', :tvos => '17.2' }", '18.0', '17.2'],
  ['expo-ios-only', { :tvos => '16.4' }, "s.platforms = { :ios => '18.0' }", '18.0', '16.4'],
  ['expo-ios-only-fallback', :absent, "s.platform = :ios, '18.0'", '18.0', '15.1'],
  ['expo-single-platform', { :tvos => '16.4' }, "s.platform = :tvos, '17.2'", '17.0', '17.2'],
  ['expo-invalid-tvos', { :tvos => '16.4' }, "s.platforms = { :ios => '18.0', :tvos => 'broken' }", '18.0', '16.4'],
  ['expo-unrelated-hash', :absent, "s.platforms = { :ios => '18.0' }; other = { :tvos => '19.0' }", '18.0', '15.1'],
  ['expo-reversed-platforms', :absent, "s.platforms = { :tvos => '17.2', :ios => '18.0' }", '18.0', '17.2']
].freeze

MUTATIONS = {
  'shared-target' => [':tvos => final_tvos_deployment_target', ':tvos => final_ios_deployment_target'],
  'missing-network' => ["s.tvos.frameworks = 'Network'", ''],
  'expo-ios-copy' => ['final_tvos_deployment_target = parsed_expo_tvos_target', 'final_tvos_deployment_target = parsed_expo_ios_target']
}.freeze

class ContractFailure < StandardError; end

def check(condition, message)
  raise ContractFailure, message unless condition
end

def verify_spec(spec, ios, tvos, expo)
  check((spec.source[:tag] || spec.source['tag']) == "v#{spec.version}", 'source-tag-prefix')
  check(spec.deployment_target(:ios).to_s == ios, 'ios-target')
  check(spec.deployment_target(:tvos).to_s == tvos, 'tvos-target')
  consumer = spec.consumer(:tvos)
  check(consumer.frameworks.include?('Network'), 'tvos-network')
  check(!spec.consumer(:ios).frameworks.include?('Network'), 'ios-network-isolation')
  check(consumer.resource_bundles['PaktaPrivacy'] == ['ios/PrivacyInfo.xcprivacy'], 'privacy-bundle')
  check(spec.available_platforms.find { |platform| platform.name == :tvos }.deployment_target.to_s == tvos, 'resource-platform-target')
  check(spec.subspecs.map(&:name).sort == (expo ? ['rn-update/Expo', 'rn-update/RCTPakta'] : ['rn-update/RCTPakta']), 'subspec-branches')
  spec.subspecs.each do |subspec|
    check(subspec.deployment_target(:tvos).to_s == tvos, 'subspec-tvos-target')
    check(subspec.deployment_target(:ios).to_s == ios, 'subspec-ios-target')
    check(subspec.consumer(:tvos).frameworks.include?('Network'), 'subspec-network')
    check(!subspec.consumer(:ios).frameworks.include?('Network'), 'subspec-ios-network-isolation')
  end
  check(spec.dependencies.any? { |dep| dep.name == 'ExpoModulesCore' } == expo, 'expo-dependency')
end

def run_matrix(source, metadata_json)
  failures = {}
  previous_arch = ENV['RCT_NEW_ARCH_ENABLED']
  previous_root = Pod::Config.instance.installation_root
  CASES.each do |name, versions, expo_content, ios, tvos|
    [false, true].each do |new_arch|
      label = "#{name}/#{new_arch ? 'new' : 'old'}"
      Dir.mktmpdir('pakta-podspec-') do |root|
        File.write(File.join(root, 'package.json'), metadata_json)
        File.write(File.join(root, 'Podfile'), expo_content ? 'use_expo_modules!' : '')
        File.write(File.join(root, 'ExpoModulesCore.podspec'), expo_content) if expo_content
        Pod::Config.instance.installation_root = Pathname.new(root)
        host = Object.new
        host.define_singleton_method(:min_ios_version_supported) { '17.0' } unless name == 'plain-rn'
        unless versions == :absent
          host.define_singleton_method(:min_supported_versions) do
            raise 'host helper error' if versions == :raises
            versions
          end
        end
        host.define_singleton_method(:`) do |command|
          system(RbConfig.ruby, '-e', 'exit 0')
          if command.include?("require('expo/package.json').version")
            "57.0.0\n"
          elsif command.include?('node -p')
            "#{root}/package.json\n"
          else
            "57.0.0\n"
          end
        end
        ENV['RCT_NEW_ARCH_ENABLED'] = new_arch ? '1' : '0'
        spec = host.instance_eval(source, File.join(root, 'rn-update.podspec'))
        begin
          verify_spec(spec, ios, tvos, !!expo_content)
        rescue ContractFailure => error
          failures[label] = error.message
        end
      end
    end
  end
  { 'total' => CASES.size * 2, 'failures' => failures }
ensure
  ENV['RCT_NEW_ARCH_ENABLED'] = previous_arch
  Pod::Config.instance.installation_root = previous_root
end

def expected_failures(mutation)
  names = CASES.map(&:first)
  if mutation == 'expo-ios-copy'
    names = %w[expo-hash-independent expo-single-platform expo-reversed-platforms]
  end
  reason = mutation == 'missing-network' ? 'tvos-network' : 'tvos-target'
  names.each_with_object({}) do |name, result|
    %w[old new].each { |arch| result["#{name}/#{arch}"] = reason }
  end
end

root = File.expand_path('..', __dir__)
source = File.read(File.join(root, 'rn-update.podspec'))
package = File.read(File.join(root, 'package.json'))
mutation = nil
unless ARGV.empty?
  abort 'Usage: ruby scripts/test-tvos-podspec.rb [--mutation NAME]' unless ARGV.size == 2 && ARGV[0] == '--mutation' && MUTATIONS.key?(ARGV[1])
  mutation = ARGV[1]
  before, after = MUTATIONS.fetch(mutation)
  abort "Mutation anchor must occur exactly once: #{mutation}" unless source.scan(before).size == 1
  source = source.sub(before, after)
end

report = run_matrix(source, package)
if mutation
  puts JSON.generate(report)
  exit(report.fetch('failures').empty? ? 0 : 1)
end

check(report.fetch('failures').empty?, "Baseline failed: #{JSON.generate(report)}")
puts "PASS production: #{report.fetch('total')}/#{report.fetch('total')} (14 hosts x old/new architecture)"
MUTATIONS.each_key do |name|
  stdout, stderr, status = Open3.capture3(RbConfig.ruby, __FILE__, '--mutation', name)
  check(status.exitstatus == 1 && stderr.empty?, "Unexpected mutation execution: #{name}: #{status.inspect}\n#{stdout}\n#{stderr}")
  result = JSON.parse(stdout)
  check(result.fetch('total') == 28 && result.fetch('failures') == expected_failures(name), "Wrong mutation failures: #{name}: #{stdout}")
  puts "PASS negative control #{name}: exit 1, #{result.fetch('failures').size}/28 named contract failures"
end
puts 'BOUNDARY: CocoaPods specification fixtures only; no pod install, Xcode build, Network link or device validation.'
