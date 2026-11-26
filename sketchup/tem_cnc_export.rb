require 'sketchup.rb'
require 'extensions.rb'

module TemCnc
  unless file_loaded?(__FILE__)
    extension = SketchupExtension.new('Tem CNC', 'tem_cnc_export/exporter')
    extension.description = 'Xuất mô hình cấu kiện ABF để tra tem trên web.'
    extension.version = '1.0.0'
    extension.creator = 'Tem CNC'
    Sketchup.register_extension(extension, true)
    file_loaded(__FILE__)
  end
end
